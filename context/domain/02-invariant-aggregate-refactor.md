---
title: Invariant & Aggregate Refactor — the serviceable-slot guarantee
created: 2026-09-13
type: refactor-plan
---

# Invariant & Aggregate Refactor — Wulkanizator GO

A plan, not an implementation. No production code, SQL or configuration is changed by this
document. Every `file:line` below was opened and read; nothing is cited from memory or inherited
from an earlier artifact without re-verification.

## 0. Context discovered

**Requirement documents exist.** `context/foundation/prd.md` (vision, success criteria with an
explicit guardrail section, FR-001–FR-010, business logic, access control),
`context/foundation/roadmap.md` (what actually shipped), `context/foundation/test-plan.md` (a
six-row risk map), plus operational rules in `AGENTS.md` and `README.md` that exist nowhere in the
PRD.

**Stack.** Astro 7 SSR + React 19 islands on Cloudflare Workers, Supabase (Postgres 15 + Auth +
PostgREST), zod at the HTTP edge, Vitest + pgTAP + Playwright.

**Where business logic lives**, layer by layer:

| Layer             | Location                       | Domain content it holds                                                                                                                                                          |
| ----------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI (React island) | `src/components/appointments/` | The submit gate `canSubmit` (`NewAppointmentForm.tsx:165`), the 409 resync (`:116-123`), the forward-only status spine (`appointment-transitions.ts:10-24`)                      |
| HTTP route        | `src/pages/api/`               | zod parse + status-code mapping only (`api/appointments/index.ts:8-39`)                                                                                                          |
| Validation        | `src/lib/schemas/`             | Shape, not domain: `.min(1)` on the two typed fields (`appointment.ts:13-19`); one real rule in `workshop-setup.ts:47-50`                                                        |
| Service           | `src/lib/services/`            | The slot algorithm (`slot-suggestions.ts:48-87`), the booking orchestration and preflight (`appointments.ts:178-215`), the transition table (`appointment-transitions.ts:45-48`) |
| Persistence       | `supabase/migrations/`         | RLS scoping, the overlap exclusion constraint, `book_appointment()`, `normalize_phone()`                                                                                         |

**There is no domain layer.** `src/types.ts` re-exports generated row types; no module owns a rule
end to end. The decisive structural fact for everything below: **the trust boundary of this system
is PostgREST, not the Astro server.** The browser holds a Supabase session and can call the
database directly, so `src/` is _one client_, not _the_ gate. The repository already learned this
twice — `20260821150000_book_appointment_ownership_check.sql:1-11` ("callable directly via
PostgREST RPC by any authenticated user") and
`20260821151500_appointments_update_status_only.sql:1-8` ("could rewrite
bay_id/starts_at/ends_at … bypassing the slot-suggestion/working-hours validation entirely").

---

## 1. Invariants identified

Rules that must always hold. Source is the document or code that states them; status uses:
**enforced** = the system structurally cannot violate it · **declared** = expressed once in code
but reachable around · **ignored** = stated somewhere, held nowhere.

| #       | Invariant                                                                           | Source                                                                                                                  | Held by                                                                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I1**  | No two live appointments overlap on the same bay                                    | `prd.md:46` "dwie wizyty na tym samym stanowisku w tym samym czasie to regresja gorsza niż kartki"; FR-005 `prd.md:121` | **Enforced** — `appointments_no_overlap_per_bay` (`20260821090000…:56-61`), asserted `rls_workshop_scope.test.sql:453-465`                                                                                                                                |
| **I2**  | An appointment's length equals the chosen service's `duration_min`                  | FR-005 `prd.md:121` "blokuje slot na podstawie czasu trwania wybranej usługi"                                           | **Declared, app-only** — derived at `appointments.ts:194-195`, then handed to the RPC as a parameter (`:202-203`); `book_appointment()` never reads `services.duration_min` (`20260825120100…:24-88`)                                                     |
| **I3**  | An appointment lies inside that weekday's opening window, and never on a closed day | `prd.md:68`, `prd.md:73`                                                                                                | **Declared, app-only** — built into the day windows (`appointments.ts:107-117`) and re-checked by the preflight (`:185-192`). `working_hours` is not read by any migration outside its own three (verified by grep); the database accepts any `starts_at` |
| **I4**  | The bay and the service belong to the caller's own workshop                         | NFR `prd.md:150`; Risk #3 `test-plan.md:47`                                                                             | **Enforced on one of two write doors** — checked inside the RPC (`20260825120100…:52-58`, asserted `rls_workshop_scope.test.sql:541-558`); **not** checked on the direct-`INSERT` door (see §3)                                                           |
| **I5**  | Only an owner creates an appointment                                                | FR-004; `prd.md:167`                                                                                                    | **Enforced** — RLS policy `20260821090000…:90-94` + in-function check `20260825120100…:48-50`                                                                                                                                                             |
| **I6**  | `no_show` / `cancelled` release the slot, the row survives                          | `prd.md:97`, `prd.md:159`                                                                                               | **Enforced** — partial predicate on the same constraint (`…:61`), asserted `rls_workshop_scope.test.sql:485-499`                                                                                                                                          |
| **I7**  | `ends_at > starts_at`                                                               | implicit                                                                                                                | **Enforced** — `appointments_ends_after_starts` (`20260821090000…:45`)                                                                                                                                                                                    |
| **I8**  | Status follows `oczekuje → w trakcie → gotowe`, sideways to `nie przyjechał`        | `prd.md:92`, `prd.md:159`                                                                                               | **Declared, and looser than the document** — `isTransitionAllowed()` (`appointment-transitions.ts:45-48`) allows any ordered pair of the four non-cancelled values; the database holds nothing beyond a column-level grant (`20260821151500…:11`)         |
| **I9**  | A committed status is what the screen shows                                         | US-04 AC `prd.md:96`; Risk #1 `test-plan.md:45`                                                                         | **Enforced by protocol** — compare-and-set on `from` (`appointments.ts:325-331`) with explicit stale/not-found/slot-taken outcomes (`:340-374`)                                                                                                           |
| **I10** | One customer per (workshop, normalized phone ≥ 9 digits); oldest name wins          | code-only; rationale `lessons.md:33-39`                                                                                 | **Enforced** — partial unique index (`20260825120000…:110-112`) + `on conflict` reuse (`20260825120100…:60-84`)                                                                                                                                           |
| **I11** | Every auth user has exactly one profile, workshop and role                          | `prd.md:175`; `README.md` §Roles                                                                                        | **Enforced** — signup trigger + fail-closed middleware (`src/middleware.ts:25-41`)                                                                                                                                                                        |
| **I12** | No user reads or writes another workshop's rows                                     | NFR `prd.md:150`                                                                                                        | **Enforced** — RLS everywhere + 66-assertion pgTAP suite (`rls_workshop_scope.test.sql:11`)                                                                                                                                                               |
| **I13** | Bays and services are retired, never deleted                                        | `prd.md:74`, `prd.md:161`                                                                                               | **Enforced** — no DELETE grant anywhere (`20260821090000…:71-72`)                                                                                                                                                                                         |
| **I14** | Domain times are naive workshop-local wall-clock                                    | `AGENTS.md` hard rule; **not in the PRD**                                                                               | **Convention only** — one module (`workshop-clock.ts:1-15`), one comment, one review habit. Nothing fails the build if a call site uses `getHours()`                                                                                                      |
| **I15** | `cancelled` is a reachable terminal state                                           | `prd.md:161`                                                                                                            | **Ignored** — the enum value and its label exist (`20260821090000…:21`, `appointment-status.ts:19`) but no code path can produce one (`schemas/appointment.ts:25`, `appointment-transitions.ts:37`)                                                       |
| **I16** | A workshop always has a usable configuration (≥1 active bay, ≥1 open day)           | implied by `prd.md:72`                                                                                                  | **Ignored** — the system degrades to messages instead (`appointments.ts:147-153`)                                                                                                                                                                         |

---

## 2. Classification, and the choice of #1

Three axes, as asked: **(a) core** — how central to the product's reason to exist; **(b) spread** —
how many files and layers the rule lives in; **(c) enforcement** — enforced / declared / ignored.

| Invariant             | (a) Core                                   | (b) Spread                                  | (c) Enforcement                     | Score            |
| --------------------- | ------------------------------------------ | ------------------------------------------- | ----------------------------------- | ---------------- |
| I1 overlap            | **Highest** — the PRD's sharpest guardrail | 3 layers (algorithm, preflight, constraint) | **Enforced** at the innermost layer | Strong           |
| **I2 duration**       | **Highest** — FR-005 _is_ this rule        | 2 layers, both above the boundary           | **Declared only**                   | ⚠️ weakest+core  |
| **I3 opening window** | **Highest** — Risk #2 names it verbatim    | 2 layers, both above the boundary           | **Declared only**                   | ⚠️ weakest+core  |
| **I4 ownership**      | High                                       | 1 layer, 1 of 2 doors                       | **Half-enforced**                   | ⚠️               |
| I5 owner-only         | High                                       | 2 layers                                    | Enforced twice                      | Fine             |
| I8 status path        | High                                       | 1 module, UI narrows further                | Declared, looser than the doc       | Second candidate |
| I14 naive time        | High (silent corruption)                   | 1 module + every call site                  | Convention                          | Third candidate  |
| I9, I6, I7, I10–I13   | Medium–High                                | —                                           | Enforced                            | Fine             |
| I15, I16              | Medium–Low                                 | —                                           | Ignored, nothing breaks today       | Park             |

### The choice, and why it is a compound

I1–I4 are not four rules. They are the four clauses of **one** rule about **one** object written by
**one** operation:

> **A stored appointment occupies a slot the workshop can actually serve** — on an active bay of its
> own workshop, for exactly the chosen service's duration, inside that weekday's opening window, and
> overlapping no other live appointment on that bay.

Selecting a single clause would produce an aggregate that guards a quarter of a rule and leaves the
other three clauses to the same ad-hoc layering that lost them in the first place. The test plan
already states the rule as a compound and treats a violation of _either_ half as one failure:

> Risk #2 — "A booking write accepts a slot the workshop cannot serve — a double-booked bay, **or a
> time outside working hours** — because the server trusts the client-supplied bay and start time
> instead of re-deriving them." (`test-plan.md:46`)

**Why this one is #1:**

1. **It is the most core rule in the product.** `prd.md:46` calls a violation "a regression worse
   than paper" — the strongest sentence in the document. The Primary Success Criterion (`prd.md:38`)
   is booking in seconds from _suggested_ slots; a suggestion the workshop cannot serve destroys the
   feature's whole premise.
2. **It is the most asymmetrically enforced.** Clause 1 (overlap) is airtight in the database.
   Clauses 2 and 3 have _nothing_ below the application layer. Clause 4 is enforced on one write
   door and not the other. One rule, four clauses, three different enforcement altitudes.
3. **The gap is invisible through the UI**, which is why it survived four slices and two
   implementation reviews: the browser path always runs the preflight, so every test that drives
   the app passes.

Runners-up, deliberately not selected: **I8** (status path) — the API is looser than the documented
flow, but its optimistic-UI half is already the best-protected code in the repo (`appointments.ts:308-374`);
**I14** (naive time) — convention-enforced and genuinely fragile, but it is a _type-system_ problem,
not an aggregate problem, and the right fix is a branded type, not a guardian object.

---

## 3. Diagnosis of the chosen invariant

### 3.1 Where the rule lives today

| Clause            | Layer             | Location                                                                                                 | Effective?                          |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1. No overlap     | Algorithm         | `slot-suggestions.ts:64-79` — never _proposes_ a colliding slot                                          | Advisory                            |
|                   | Service preflight | `appointments.ts:185-192` — re-derives the suggestion list and rejects a start that is no longer offered | Advisory                            |
|                   | Database          | `20260821090000…:56-61` exclusion constraint                                                             | **Authoritative**                   |
| 2. Duration       | Service           | `appointments.ts:194-195` — `ends_at = starts_at + preflight.durationMin`                                | Advisory                            |
|                   | Database          | —                                                                                                        | **Absent**                          |
| 3. Opening window | Service           | `appointments.ts:107-117` builds day windows; `:185-192` re-checks                                       | Advisory                            |
|                   | Database          | —                                                                                                        | **Absent**                          |
| 4. Ownership      | RPC               | `20260825120100…:52-58`                                                                                  | **Authoritative on this door only** |
|                   | Direct `INSERT`   | policy `20260821090000…:90-94` checks `workshop_id` and role — **not** `bay_id`'s workshop               | **Absent**                          |

### 3.2 The two doors

`book_appointment()` is **not** the only way to create an appointment. Both doors are granted to
`authenticated`:

```
grant select, insert on public.customers to authenticated;              -- 20260821090000…:71
grant select, insert, update on public.appointments to authenticated;   -- 20260821090000…:72
grant execute on function public.book_appointment(…) to authenticated;  -- 20260821090000…:160
```

Door 2 is not hypothetical — the pgTAP suite itself walks through it as a legitimate path
(`rls_workshop_scope.test.sql:730-741`, `lives_ok` on a raw `insert into public.appointments` as
owner A). Its only gate is `appointments_insert_owner` (`20260821090000…:90-94`), whose `with check`
tests `workshop_id = current_workshop_id()` and `current_user_role() = 'owner'` and nothing else.
The foreign key on `bay_id` proves _existence_, not membership, and FK checks bypass RLS. So an
authenticated owner of workshop A can, with one PostgREST call:

- book a 40-minute service as a 5-minute block, or a 5-minute service as an 8-hour one (clause 2);
- book at 03:00 on a Sunday the workshop marks closed (clause 3);
- **occupy workshop B's bay** with a row stamped `workshop_id = A`, invisible to B because RLS
  hides A's rows from B — precisely the F1 finding that
  `20260821150000_book_appointment_ownership_check.sql:1-11` closed on the RPC and left open here
  (clause 4).

That last one is the sharpest finding in this document: **the fix for a CRITICAL implementation
review was applied to one door of two.**

### 3.3 Where the client is the only guard

For clauses 2 and 3 the _entire_ enforcement chain is: the React island only offers chips the
server computed (`NewAppointmentForm.tsx:104` echoes `selectedSlot.start` verbatim) → the service
re-derives the same list (`appointments.ts:185-192`). Both live in code the caller can skip. The
zod schema does not help: `appointmentBookingRequestSchema` (`schemas/appointment.ts:13-19`)
constrains shape only — a uuid, a timestamp regex, two `.min(1)` strings.

### 3.4 Where the error is swallowed

`src/pages/api/appointments/index.ts:36-39` catches everything the service throws and answers
`500 { error: "Failed to book appointment" }`. `appointments.ts:206-212` maps exactly one code
(`23P01` → conflict) and rethrows the rest. So today, _every_ domain rejection the RPC raises —
"only an owner may book", "bay does not belong to this workshop" — reaches the client as an
anonymous server error, English, unbranchable. That is Risk #5 (`test-plan.md:49`) applied to the
very rule Risk #2 is about. Any new precondition added to the RPC inherits the same fate unless
the mapping is fixed in the same change.

### 3.5 What the rule costs today

The preflight at `appointments.ts:185-192` is a **correctness dependency**, which is why it must run
a full second suggestion pass on every booking (four queries, `:88-98`). It should be a UX
affordance — the thing that returns fresh chips instead of a bare error.

---

## 4. The guardian aggregate

### 4.1 Root and boundary

**Aggregate root: `WorkshopSchedule`**, identified by `workshop_id`.

Consistency boundary — everything needed to decide the rule in one transaction:

```
WorkshopSchedule (root, id = workshop_id)
├── WorkingHours[7]        (value objects: weekday → open window | closed)
├── Bay[]                  (entities: id, name, is_active)
├── Service[]              (entities: id, duration_min, is_active)
└── Appointment[]          (entities: bay, [starts_at, ends_at), status)
```

**Why workshop-wide rather than bay-wide.** A `BaySchedule` root would own clause 1 and have to
reach outside itself for clauses 2 and 3 — `duration_min` is a workshop catalogue entry and the
opening window is a workshop policy. An aggregate that cannot check its own invariant is not the
boundary.

**Why the aggregate is written in SQL, not TypeScript.** §0 established that the trust boundary is
PostgREST. A `src/lib/domain/WorkshopSchedule.ts` would be advisory for the same reason the current
preflight is: the caller can skip it. In a BaaS architecture the aggregate root is the
`security definer` function plus the constraints around it; the TypeScript service becomes a
**client of the aggregate**, not its owner. The repository has already reached this conclusion twice
by other routes (`20260821090000…:9-11`, `20260821151500…:1-8`).

**Atomicity.** A plpgsql function body is one implicit transaction: the preconditions and both
inserts commit or roll back together. This is already load-bearing for I10
(`20260825120100…:9-12`).

### 4.2 The single entry point

```sql
-- Aggregate method: WorkshopSchedule.book(customer, service, bay, startsAt)
public.book_appointment(
  p_first_name  text,
  p_phone       text,
  p_service_id  uuid,
  p_bay_id      uuid,
  p_starts_at   timestamp          -- p_ends_at is GONE: derived, never accepted
) returns public.appointments
```

Removing `p_ends_at` is the design's centre. Clause 2 stops being _checked_ and starts being
_structurally impossible to violate_ — the caller can no longer express a wrong duration.

⚠️ **Signature change mechanics.** `create or replace function` cannot change a parameter list, and
`drop function` discards the `execute` grant (`20260821090000…:160`). The old six-argument overload
must be dropped explicitly, or it survives as an overload and the unguarded door stays open behind
a shorter name.

### 4.3 Preconditions and named domain errors

Fail-fast: every violation raises and aborts. No logging-and-continuing, no silent clamp.

| #   | Precondition                                                            | Domain error               | SQLSTATE | HTTP |
| --- | ----------------------------------------------------------------------- | -------------------------- | -------- | ---- |
| P1  | A workshop resolves for the caller                                      | `workshop_unresolved`      | `WG001`  | 403  |
| P2  | Caller's role is `owner`                                                | `booking_requires_owner`   | `WG002`  | 403  |
| P3  | `p_bay_id` ∈ this workshop **and** `is_active`                          | `bay_not_bookable`         | `WG003`  | 409  |
| P4  | `p_service_id` ∈ this workshop **and** `is_active`                      | `service_not_bookable`     | `WG004`  | 409  |
| P5  | The weekday's `working_hours` row is not `is_closed`                    | `workshop_closed_that_day` | `WG005`  | 409  |
| P6  | `[p_starts_at, derived_ends_at)` ⊆ `[opens_at, closes_at)` on that date | `outside_working_hours`    | `WG006`  | 409  |
| P7  | No overlap on the bay                                                   | _(existing)_               | `23P01`  | 409  |

A named SQLSTATE rather than today's bare `raise exception` (which yields `P0001` plus prose) is
what lets the client branch on a code instead of a message — the explicit demand of Risk #5
(`test-plan.md:49`) and the shape `appointments.ts:207` already uses for `23P01`.

**P7 stays a constraint, never a `select … where overlaps`.** A check-then-insert loses a concurrent
race; the original migration wrote this down (`20260821090000…:9-11`) and the dedupe migration
repeated it (`20260825120100…:9-12`). The aggregate's job is to _react_ to the constraint, not
re-implement it.

### 4.4 Pseudocode

```sql
create function public.book_appointment(
  p_first_name text, p_phone text,
  p_service_id uuid, p_bay_id uuid, p_starts_at timestamp
) returns public.appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_workshop_id uuid;  v_duration_min int;  v_ends_at timestamp;
  v_hours public.working_hours;  v_customer_id uuid;  v_appointment public.appointments;
begin
  -- P1/P2: unchanged, carried over verbatim from 20260825120100…:42-50
  v_workshop_id := public.current_workshop_id();
  if v_workshop_id is null then
    raise exception 'no workshop resolved for current user' using errcode = 'WG001';
  end if;
  if public.current_user_role() <> 'owner' then
    raise exception 'only an owner may book an appointment' using errcode = 'WG002';
  end if;

  -- P3: bay must belong to this workshop AND be active (today: ownership only)
  if not exists (select 1 from public.bays
                 where id = p_bay_id and workshop_id = v_workshop_id and is_active) then
    raise exception 'bay does not belong to this workshop or is retired' using errcode = 'WG003';
  end if;

  -- P4 + clause 2: the duration is READ, not accepted
  select duration_min into v_duration_min
  from public.services
  where id = p_service_id and workshop_id = v_workshop_id and is_active;

  if v_duration_min is null then
    raise exception 'service does not belong to this workshop or is retired' using errcode = 'WG004';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_min);

  -- P5/P6 + clause 3: the opening window for THAT date's weekday.
  -- extract(dow) matches working_hours.weekday, which appointments.ts:111 reads via getUTCDay().
  select * into v_hours
  from public.working_hours
  where workshop_id = v_workshop_id and weekday = extract(dow from p_starts_at)::int;

  if v_hours is null or v_hours.is_closed then
    raise exception 'the workshop is closed that day' using errcode = 'WG005';
  end if;

  if p_starts_at::time < v_hours.opens_at
     or v_ends_at > (p_starts_at::date + v_hours.closes_at) then
    raise exception 'appointment falls outside working hours' using errcode = 'WG006';
  end if;

  -- I10: customer reuse — carried over verbatim from 20260825120100…:60-84
  …

  -- P7: no pre-check. The exclusion constraint raises 23P01 and rolls the whole body back.
  insert into public.appointments
    (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
  values (v_workshop_id, v_customer_id, p_service_id, p_bay_id, p_starts_at, v_ends_at)
  returning * into v_appointment;

  return v_appointment;
end; $$;
```

⚠️ **The `v_ends_at > closes_at` comparison must not cross midnight.** `working_hours.closes_at` is
a `time` (`20260815183000…:49`); composing it onto `p_starts_at::date` is correct only because
`working_hours_window_valid` (`20260820120000…:10-14`) guarantees `opens_at < closes_at`, i.e. no
overnight windows exist. That constraint is a _precondition of this design_ and must be cited in
the migration comment so a future overnight-hours feature cannot silently break the guard.

### 4.5 Closing the second door

```sql
revoke insert on public.appointments from authenticated;
drop policy appointments_insert_owner on public.appointments;
```

Direct precedent, same table, same reasoning, three migrations earlier:
`20260821151500_appointments_update_status_only.sql:10-11` did exactly this to `UPDATE`.

`book_appointment()` is unaffected — `security definer` runs its inserts as the function owner. The
Playwright `seedAppointment()` helper (`e2e/support/db.ts:80-88`) is also unaffected: it connects
over `E2E_DATABASE_URL` as a superuser, not as `authenticated`.

What **is** affected: the pgTAP suite's five raw inserts (`rls_workshop_scope.test.sql:403, 454,
468, 486, 731`). Three of them exist to test the exclusion constraint directly and must be rewritten
to call `book_appointment()` (or keep testing the constraint from a superuser session). The
`select plan(54 + 12)` count (`:11`) changes with them.

### 4.6 The repository / port on the TypeScript side

`bookAppointment()` (`appointments.ts:178-215`) becomes a **mapper**, not a gatekeeper. It keeps the
preflight — demoted from correctness to UX, which is the point — and gains a code table:

```ts
// One Record keyed by SQLSTATE, not an if-chain: a new code added to the migration without a
// mapping here fails the build, the same reason IS_MUTABLE is shaped this way
// (appointment-transitions.ts:32-38).
export type BookingRejection =
  | "bay_not_bookable"
  | "service_not_bookable"
  | "workshop_closed_that_day"
  | "outside_working_hours"
  | "booking_requires_owner"
  | "workshop_unresolved";

const REJECTION_BY_SQLSTATE: Record<string, BookingRejection> = {
  WG001: "workshop_unresolved",
  WG002: "booking_requires_owner",
  WG003: "bay_not_bookable",
  WG004: "service_not_bookable",
  WG005: "workshop_closed_that_day",
  WG006: "outside_working_hours",
};

export type BookOutcome =
  | { status: "created"; appointment: Appointment }
  | { status: "conflict"; slots: SuggestedSlot[]; emptyReason: EmptyReason } // 23P01, unchanged
  | { status: "rejected"; reason: BookingRejection; slots: SuggestedSlot[] }; // new
```

A `rejected` outcome carries fresh slots too, so the island can resync exactly as it does on a 409
rather than dead-ending on an error string.

### 4.7 The thin route

`src/pages/api/appointments/index.ts` keeps its three responsibilities and gains no fourth: parse →
call the aggregate → map the outcome. The change is that `rejected` no longer falls into the
catch-all 500 (`:36-39`):

```ts
if (outcome.status === "rejected") {
  return Response.json(
    { error: REJECTION_COPY[outcome.reason], reason: outcome.reason, slots: outcome.slots.map(toWireSlot) },
    { status: 409 },
  );
}
```

`reason` is the machine-readable field; `REJECTION_COPY` holds the Polish user-facing strings —
never the SQL message, which is English (`lessons.md` §"Never chain through `failure.message`…").

---

## 5. Before / after

| Where the rule lives today                          | Before                                                                            | After                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `slot-suggestions.ts:64-79`                         | Computes non-overlapping slots                                                    | **Unchanged.** Still the suggestion engine; never the guard                                                     |
| `appointments.ts:185-192` (preflight)               | Correctness dependency — the only thing standing between the client and a bad row | **Kept, demoted.** A UX affordance that returns fresh chips. Removing it would be safe; keeping it is better UX |
| `appointments.ts:194-195` (`ends_at`)               | Derived in TypeScript, sent over the wire                                         | **Deleted.** The parameter no longer exists                                                                     |
| `appointments.ts:197-204` (RPC call)                | 6 arguments                                                                       | 5 arguments                                                                                                     |
| `appointments.ts:206-212` (errors)                  | One code mapped, the rest rethrown into a 500                                     | Six named codes mapped to `rejected`; `23P01` still `conflict`                                                  |
| `book_appointment()` `20260825120100…:42-58`        | Four guards: workshop, role, bay-exists-in-workshop, service-exists-in-workshop   | Seven: + bay active, + service active & duration read, + closed day, + opening window                           |
| `book_appointment()` `:86-88`                       | Inserts caller-supplied `p_ends_at`                                               | Inserts derived `v_ends_at`                                                                                     |
| `grant insert on appointments` `20260821090000…:72` | Any owner may insert any appointment row directly                                 | Revoked; the RPC is the only door                                                                               |
| `appointments_insert_owner` `…:90-94`               | The only gate on door 2                                                           | Dropped with the grant                                                                                          |
| `api/appointments/index.ts:36-39`                   | Every domain rejection → 500, English prose                                       | Rejections → 409 with a `reason` code + Polish copy                                                             |
| `NewAppointmentForm.tsx:116-123`                    | Handles 409 by resyncing chips                                                    | **Unchanged** — a rejection arrives in the same shape                                                           |
| `rls_workshop_scope.test.sql:403-499, 730-741`      | Five raw inserts, three of them the constraint's own tests                        | Rewritten through the RPC; `plan()` count updated                                                               |

**Net effect on the application layer is subtraction, not addition**: one derived value and one
wire parameter disappear, and one advisory check stops being load-bearing.

---

## 6. Refactor phases

The project has a test-first discipline (`/10x-tdd`), three runners (`npm test`, `npm run db:test`,
`npm run test:e2e`) and a pgTAP suite that is the natural home for a database-enforced invariant.
Phases 0–2 are **test-first**; Phase 3 is a mapping change with unit coverage; Phase 4 is documents.

| Phase | Test-first? | What lands                                                                                                                                                                              | Proof it worked                                                                                                                    |
| ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **0** | ✅ red      | Add the §7 assertions to `supabase/tests/rls_workshop_scope.test.sql` against today's schema                                                                                            | They **fail**. That failure _is_ the evidence the three clauses are unheld — the deliberate-break check, inverted                  |
| **1** | ✅ green    | Migration: drop the 6-arg overload, create the 5-arg aggregate method with P3–P6 and named SQLSTATEs, re-grant `execute`                                                                | Phase 0's assertions go green with no edits to the test file                                                                       |
| **2** | ✅          | Migration: `revoke insert` + drop the insert policy. Rewrite the suite's five raw inserts through the RPC; update `plan()`                                                              | A raw `insert into public.appointments` as `authenticated` now raises `42501`                                                      |
| **3** | unit        | `appointments.ts`: drop `p_ends_at`, add `REJECTION_BY_SQLSTATE`, widen `BookOutcome`. Route mapping. `npm run db:types`                                                                | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`; `npm run test:e2e` core loop still green                         |
| **4** | —           | Docs: `prd.md` FR-005 (name the derivation), `test-plan.md` Risk #2 coverage row, `AGENTS.md` (the RPC is the only appointment-write path), a `lessons.md` entry on one-door aggregates | `grep` finds no doc still describing the old contract                                                                              |
| **5** | optional    | Wire `npm run db:test` into `.github/workflows/ci.yml`                                                                                                                                  | Otherwise this invariant's entire net runs only on a developer's laptop (`ci.yml` runs lint/test/typecheck/build and nothing else) |

**Phase 5 is not optional in substance.** Phases 0–2 move the rule into the database and its proof
into pgTAP — a suite that does not currently run in CI. Landing 0–4 without 5 trades an unenforced
rule for an unverified one.

**Ordering constraint.** Phase 2 must follow Phase 1: revoking the grant before the RPC can enforce
the clauses would leave a window with no working write path for the pgTAP suite.

**Relationship to approved work.** `context/changes/refactor-opportunities/plan.md` folds the
booking submit onto `requestJson` and touches `NewAppointmentForm.tsx` plus the 409 branch. It is
orthogonal in altitude but **meets this plan at the failure shape**: both change what a non-201
booking response looks like to the island. Land one, then the other — not concurrently.

---

## 7. Test cases for the invariant

pgTAP, in `supabase/tests/rls_workshop_scope.test.sql`, as owner A unless noted. Fixtures exist
(`supabase/seed.sql`): two workshops, an owner each, a worker in A.

**Legal (must succeed):**

| #   | Case                                                           | Assertion                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| L1  | Book inside the window on an active bay of one's own workshop  | `lives_ok`; and `ends_at - starts_at = services.duration_min` |
| L2  | Book starting exactly at `opens_at`                            | `lives_ok`                                                    |
| L3  | Book ending exactly at `closes_at`                             | `lives_ok` — the `[)` boundary, mirroring `:467-477`          |
| L4  | Book back-to-back with an existing appointment on the same bay | `lives_ok` (existing behaviour, must not regress)             |
| L5  | Book over a `no_show` window                                   | `lives_ok` (I6, must not regress)                             |
| L6  | Second visit, same normalized phone                            | `lives_ok`, no new `customers` row (I10, must not regress)    |

**Illegal (must raise, and raise the _named_ code):**

| #   | Case                                                                                                       | Expected                                                |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| X1  | `starts_at` one minute before `opens_at`                                                                   | `WG006`                                                 |
| X2  | A duration that would run past `closes_at`                                                                 | `WG006`                                                 |
| X3  | `starts_at` on a weekday with `is_closed = true`                                                           | `WG005`                                                 |
| X4  | Another workshop's `bay_id` (the F1 regression, now on the RPC **and** provably closed on the direct door) | `WG003`                                                 |
| X5  | Another workshop's `service_id`                                                                            | `WG004`                                                 |
| X6  | A retired (`is_active = false`) bay                                                                        | `WG003`                                                 |
| X7  | A retired service                                                                                          | `WG004`                                                 |
| X8  | Overlapping a live appointment on the same bay                                                             | `23P01`                                                 |
| X9  | Worker A calls the RPC                                                                                     | `WG002`                                                 |
| X10 | **Raw `insert into public.appointments` as owner A**                                                       | `42501` — the door is shut                              |
| X11 | The 6-argument overload is gone                                                                            | `undefined_function` / absent from `pg_proc`            |
| X12 | Losing the overlap race leaves no orphan customer                                                          | count unchanged (existing `:512-528`, must not regress) |

**Duration cannot be tested as a rejection** — X-nothing. That is the design working: once
`p_ends_at` is not a parameter, a wrong duration is unexpressible, so its only test is L1's equality
assertion. An invariant you cannot write a violation test for is the strongest kind.

Unit (Vitest, `appointments.test.ts`): each SQLSTATE in `REJECTION_BY_SQLSTATE` maps to its
`rejected` reason; an unmapped code still rethrows; `23P01` still yields `conflict`.

---

## 8. Load-bearing names to register

The repository has **no contract registry on disk** — `CLAUDE.md` names
`docs/reference/contract-surfaces.md` but no such file exists (`docs/` is absent entirely). Creating
it is out of scope here; the list below is what belongs in it on the day it exists, and belongs in
the migration comments regardless.

| Name                                                     | Kind                 | Why load-bearing                                                                                    |
| -------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `public.book_appointment(text,text,uuid,uuid,timestamp)` | RPC, 5-arg           | The aggregate's only entry point. Its signature _is_ the contract; the 6-arg form must stay dropped |
| `WG001`–`WG006`                                          | SQLSTATEs            | The wire contract between the aggregate and every client. Never renumber                            |
| `BookingRejection`                                       | TS union             | Mirrors the codes; exhaustiveness is the build-time guard                                           |
| `REJECTION_BY_SQLSTATE`                                  | TS `Record`          | The single mapping point; a `Record` (not a switch) so a missing code fails the build               |
| `BookOutcome.rejected`                                   | TS variant           | New third arm; every consumer's switch must handle it                                               |
| `working_hours_window_valid`                             | check constraint     | The §4.4 midnight-crossing guard depends on it. Removing it silently breaks P6                      |
| `appointments_no_overlap_per_bay`                        | exclusion constraint | Clause 1's sole authority; the aggregate deliberately does not duplicate it                         |
| absence of `insert` grant on `public.appointments`       | grant state          | The "single door" property. A future migration re-granting it reopens everything this plan closes   |

---

## Summary

Sixteen invariants were extracted from the PRD, the roadmap, the operational docs and the code, and
classified on three axes — how core the rule is, how far it is spread across layers, and whether it
is actually enforced. The selected #1 is the compound rule that **a stored appointment occupies a
slot the workshop can actually serve**: it is the strongest sentence in the PRD (`prd.md:46`, "worse
than paper"), it is Risk #2 in the test plan almost word for word, and its four clauses sit at three
different enforcement altitudes — overlap is airtight in the database, service duration and opening
hours have nothing below the application layer, and workshop ownership is enforced on one write door
of two. The second door is the finding this diagnosis adds: `grant insert on public.appointments to
authenticated` plus a policy that checks only `workshop_id` and role leaves an authenticated owner
able to insert an appointment with any duration, at 03:00 on a closed Sunday, on another workshop's
bay — reopening by a different path the exact CRITICAL review finding that
`20260821150000_book_appointment_ownership_check.sql` closed on the RPC. The design answer is a
`WorkshopSchedule` aggregate whose root is the `security definer` function, not a TypeScript class,
because in this architecture the trust boundary is PostgREST and any rule living in `src/` is
advisory by construction. Its centre is subtractive: `p_ends_at` stops being a parameter and becomes
a derivation from `services.duration_min`, which makes a wrong duration unexpressible rather than
merely rejected, while three new preconditions with named SQLSTATEs cover the active bay, the closed
day and the opening window, and the exclusion constraint keeps owning the race. The application
layer gets smaller, not larger — the preflight in `appointments.ts:185-192` is demoted from
correctness dependency to UX affordance, and the route stops swallowing domain rejections as
anonymous 500s. Six phases are proposed, the first of them deliberately red: the new pgTAP
assertions are written against today's schema so their failure is the evidence that the clauses are
unheld, and the last of them wires `npm run db:test` into CI, without which this work trades an
unenforced rule for an unverified one.
