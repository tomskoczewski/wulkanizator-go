# Add Appointment with Free-Slot Suggestions (S-02) — Implementation Plan

## Overview

Close the S-01 → S-02 link in the roadmap's critical path: the owner picks a service, types a
walk-in customer's first name and phone, the system suggests the nearest free slots computed from
service duration, bay occupancy and working hours, and one tap books the appointment with status
`waiting` on an automatically-chosen bay.

This is the product's domain core. The PRD names the guardrail in absolute terms — two appointments
on the same bay at the same time is "a regression worse than paper" (`prd.md:41`) — so the
correctness guarantee lives in Postgres as an exclusion constraint, not in application code.

## Current State Analysis

S-01 shipped and is archived. The three configuration tables this slice reads all exist, and the
migration that added them says so explicitly in its own header: they are what "S-02's
slot-suggestion algorithm reads".

- `bays` (`supabase/migrations/20260815183000_workshop_configuration.sql:21-30`) — `is_active` soft
  delete; the slot search must filter on it.
- `services` (`:32-42`) — `duration_min int not null` with a `> 0` check; the algorithm's duration
  input.
- `working_hours` (`:44-56`) — nullable `opens_at`/`closes_at` as Postgres `time` (local wall-clock)
  plus `is_closed`, one row per weekday, `weekday` following Postgres `dow` (0 = Sunday). The
  window/closed invariant is enforced in the database as of
  `supabase/migrations/20260820120000_working_hours_window_check.sql`, added precisely because this
  slice reads those rows directly.
- Every workshop is guaranteed a non-empty configuration: `seed_workshop_defaults()`
  (`supabase/migrations/20260815183100_seed_workshop_defaults.sql:13-57`) gives every new workshop
  six services, one bay and seven working-hours rows. The algorithm will therefore never meet a
  workshop with zero `bays` *rows* or missing hours — but it can meet zero **active** bays, which is
  what it actually filters on: `/ustawienia` deactivates a bay with no minimum-one guard
  (`src/components/settings/Bays.tsx:24`, `bayUpdateSchema` accepts `is_active`). It can equally meet
  `is_closed = true` on every weekday. Both are normal empty results, not errors — but they are
  *different* empty results and the owner needs to be told which.

What is missing:

- **No customer storage of any kind.** No `customers` table; FR-009's walk-in minimum (first name +
  phone) has nowhere to go today.
- **No appointment storage, and no time-of-day model anywhere in the repo.** `src/` contains no
  `Intl.*` usage, no `timeZone` string, no `Europe/Warsaw`, and `package.json` has no date library.
- **No JavaScript test runner.** The only suite is pgTAP (`supabase/tests/rls_workshop_scope.test.sql`,
  26 assertions, run by `npm run db:test`).
- **`btree_gist` is available but not installed** — verified against the local stack
  (`pg_available_extensions` reports 1.7 available, `installed_version` null).

## Desired End State

An owner signed in at `/wizyty/nowa` can book an appointment end-to-end in a few taps, and the
booked slot is provably unbookable a second time.

Verification: with the local stack running and the S-01 seed applied, booking a 45-minute service
from the first suggested chip creates an `appointments` row with `status = 'waiting'`, a resolved
`bay_id`, and a linked `customers` row. Re-submitting the same slot returns HTTP 409 with a fresh
suggestion list rather than a second row. Two concurrent inserts of the same slot leave exactly one
row, rejected at the database by `appointments_no_overlap_per_bay`.

### Key Discoveries:

- The slot search decomposes into four steps and an off-the-shelf library covers only one of them
  (`research.md:60-65`): resolving the working-hours window, converting to a comparable instant,
  sliding a duration cursor per bay, and fanning out across 1–5 bays. Every candidate package models
  a *single* resource's busy list, so the fan-out, merge and ranking are ours regardless. Combined
  with the maintenance signals in `research.md:49-56` (best functional match: 124 weekly downloads;
  only package with real adoption unmaintained since 2024-04 and pulling Luxon into a Workers
  bundle), the decision is to write ~80 lines with zero dependencies.
- **Choosing naive local `timestamp` deletes the hard half of the timezone problem.** `research.md:130`
  flags local-wall-clock → instant as "the two-pass offset trick, a classic bug source". Storing
  wall-clock means that conversion never happens: nothing is converted for storage. The only
  remaining direction is instant → local parts (to answer "what time is it in the workshop now?"),
  which `Intl.DateTimeFormat` does natively on Workers with zero dependencies. `@date-fns/tz`, which
  `research.md:131` recommends under the `timestamptz` model, is therefore not needed here.
- Poland's DST transition happens at 02:00–03:00 on a Sunday (`research.md:133`), outside every
  plausible working window — the S-01 default is 07:00–18:00. No slot this algorithm can generate is
  DST-ambiguous under either model.
- The partial `where (status not in ('cancelled', 'no_show'))` on the exclusion constraint implements
  S-04's "`no-show` releases the slot" (`roadmap.md:140`) for free, while keeping the row in history
  (`research.md:123`).
- The raw Postgres exclusion-violation `DETAIL` names the conflicting row's key and is produced
  **before** RLS filtering (`research.md:124`) — forwarding it to the client leaks another row's
  data. The API must translate SQLSTATE `23P01` to a generic message.
- The brochure's `AddVisitScreen` (`wulkanizator-go-brochure/src/App.jsx:402-473`, cloned locally at
  `/Users/tomaszskoczewski/Code/wulkanizator-go-brochure`) shows **no bay control** — slot chips are
  times only (`:414-421`), confirming the system assigns the bay.
- `MobilePreview` (`App.jsx:876`) is the *day plan* mobile variant, not an add-visit variant. S-02's
  only mobile obligation is that `AddVisitScreen`'s `md:grid-cols-2` grids collapse to one column at
  360px, which they already do.
- Existing conventions to follow verbatim: RLS shape from
  `supabase/migrations/20260814235519_role_and_workshop_scope.sql:73-102` (grant exactly the
  operations that have a policy, scope reads with `current_workshop_id()`, gate writes additionally
  on `current_user_role() = 'owner'`); service layer from `src/lib/services/workshop-setup.ts`
  (never accept a `workshop_id` parameter — resolve it via the `current_workshop_id` RPC, see
  `:52-56`); API route shape from `src/pages/api/bays/index.ts`; client mutation handling from
  `src/components/hooks/useJsonMutation.ts`.

## What We're NOT Doing

- **No "add now" walk-in escape hatch** (`roadmap.md:119`, `research.md:169`). Every appointment goes
  through a suggested slot, so there is exactly one code path and one invariant.
- **No manual slot or bay override** — already Parked in `roadmap.md:204`.
- **No bay eligibility rules.** Every active bay can perform every service; `bays.vehicle_type` stays
  a display label. This resolves `research.md:172`, the one open question flagged as blocking.
- **No editing, cancelling, or status changes.** Insert-only. S-04 owns transitions.
- **No day-plan rendering.** S-03 owns it; this slice's success is verified via the database and the
  form's own confirmation.
- **No customer directory, search, or cars.** S-05 owns them. `customers` gets `first_name` and
  `phone` only. This also drops the brochure's **"Auto"** cell (`App.jsx:437-440`) from the form —
  there is nothing behind it until S-05.
- **No "Opony" or "Notatka" blocks** from the brochure (`App.jsx:456-467`) — S-06 and FR-008
  respectively.
- **No date picker.** Suggestions roll forward automatically; the owner never chooses a date.
- **No new runtime dependency.** Vitest is a dev dependency only.

## Implementation Approach

Defence in depth, with each layer owning a different job (`research.md:150`): zod rejects malformed
input at the API boundary; the suggestion algorithm avoids *proposing* a conflict; the exclusion
constraint *guarantees* one cannot be stored. The first two are UX, the third is correctness — a
check-then-insert in the API route loses to two simultaneous requests, so the database is the only
place the guarantee can live.

Times are naive local wall-clock throughout: `timestamp` columns, `tsrange` in the constraint, and
plain `Date` objects in the algorithm interpreted as workshop-local. One small helper module owns
the single conversion the system still needs — "what is the workshop's wall-clock now, and what
weekday is it" — via `Intl.DateTimeFormat` with `Europe/Warsaw`. Nothing else in the codebase
touches timezones.

The algorithm is a pure synchronous function with no Supabase import, which is what makes the edge
matrix testable without a database. A thin service fetches its inputs.

## Critical Implementation Details

**Half-open intervals, consistently.** `[start, end)` must hold across the TypeScript algorithm, the
zod schema and the SQL constraint (`'[)'` bound). `research.md:152` names the failure this prevents:
mixing inclusive and half-open bounds between layers produces an off-by-one that manifests as a
phantom conflict at exactly the back-to-back boundary — the most common case in a tire workshop,
where a 10:00–11:00 job sits directly against an 11:00–12:00 job.

**Weekday convention.** `working_hours.weekday` follows Postgres `dow` (0 = Sunday), per
`20260815183100_seed_workshop_defaults.sql:41-42`, and JavaScript numbers weekdays the same way — but
the value must be derived from the *workshop-local* date, not the UTC one. On a Worker running UTC, a
booking made at 00:30 Warsaw time on Monday is still Sunday in UTC, and reading Sunday's
`is_closed = true` row would wrongly report the workshop closed.

The accessor is therefore **`getUTCDay()`**, not `getDay()`. `workshop-clock.ts` returns a naive
`Date` whose *UTC* fields already hold workshop-local wall-clock values, so `getUTCDay()` reads the
local weekday while `getDay()` re-applies the runtime zone and lands back on exactly the bug above.
The same holds throughout: on any naive `Date` in this slice, `getDay()`, `getHours()` and the rest
of the local-field accessors are banned — use their `getUTC*` counterparts.

**Extension ordering.** `create extension if not exists btree_gist` must execute before the
`alter table ... add constraint ... exclude using gist` that mixes the `=` co-key with `&&`
(`research.md:121`). Both belong in the same migration, in that order.

## Phase 1: Schema, RLS & the overlap guard

### Overview

Create `customers` and `appointments` under the F-01 scoping contract, install the overlap guard, and
prove both the isolation and the double-booking rejection in pgTAP before any application code reads
these tables.

### Changes Required:

#### 1. Appointments schema migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_appointments_and_customers.sql`

**Intent**: Add the two domain tables this slice writes, the status enum the whole appointment
lifecycle will use, and the database-level guarantee that no two live appointments can occupy the
same bay at the same time. Follow the RLS pattern from
`20260814235519_role_and_workshop_scope.sql` verbatim, including its rule that table grants mirror
exactly the operations that have a policy.

**Contract**:

- `create extension if not exists btree_gist;` — first statement in the file (see Critical
  Implementation Details).
- `public.appointment_status` enum with all five values: `waiting`, `in_progress`, `done`,
  `no_show`, `cancelled`. This slice only ever inserts `waiting`; the remaining four are already
  colour-mapped in `context/foundation/design-system.md:82-88` and S-04 owns the transitions, so
  defining the type once avoids a later `alter type`.
- `public.customers` — `id uuid pk`, `workshop_id uuid not null references workshops on delete
  cascade`, `first_name text not null`, `phone text not null`, `created_at timestamptz not null
  default now()`. Index on `workshop_id`.
- `public.appointments` — `id uuid pk`, `workshop_id uuid not null references workshops on delete
  cascade`, `customer_id uuid not null references customers on delete restrict`, `service_id uuid
  not null references services on delete restrict`, `bay_id uuid not null references bays on delete
  restrict`, `starts_at timestamp not null`, `ends_at timestamp not null`, `status
  public.appointment_status not null default 'waiting'`, `created_at timestamptz not null default
  now()`. Note the deliberate split: `starts_at`/`ends_at` are naive wall-clock `timestamp`;
  `created_at` stays `timestamptz` because it records a real instant.
- `check (ends_at > starts_at)`.
- Index on `(workshop_id, starts_at)` — the day-range read both this slice and S-03 issue.
- The overlap guard, after the table exists:

  ```sql
  alter table public.appointments
    add constraint appointments_no_overlap_per_bay
    exclude using gist (
      bay_id with =,
      tsrange(starts_at, ends_at, '[)') with &&
    ) where (status not in ('cancelled', 'no_show'));
  ```

  `tsrange` (not `tstzrange`) because the columns are naive. The `'[)'` bound is what makes
  back-to-back appointments legal. The partial `where` is what makes a `no_show` release its slot.
- RLS on both tables. Grants: `select, insert` on both; `update` on `appointments` only (S-04 needs
  it; `customers` update lands with S-05's edit UI). No `delete` grant or policy on either — matching
  the soft-delete posture S-01 established.
- Policies: `select` scoped to `workshop_id = public.current_workshop_id()` for **both roles** —
  workers must read appointments for S-03/S-04. `insert` gated additionally on
  `public.current_user_role() = 'owner'` (FR-004 and the PRD's Access Control both make adding a
  visit an owner action). The `appointments` `update` policy is workshop-scoped for both roles, since
  S-04's whole point is that a worker changes status.
- `public.book_appointment(p_first_name text, p_phone text, p_service_id uuid, p_bay_id uuid,
  p_starts_at timestamp, p_ends_at timestamp)` — `security definer`, returns the inserted
  `public.appointments` row. Inserts the `customers` row and the `appointments` row in one function
  body, so Postgres runs both in a single implicit transaction: an exclusion violation on the second
  insert rolls the first back, and a lost race can never leave an orphan customer behind. This is
  what makes the client's 409-retry loop (Phase 4) safe to repeat.

  Because `security definer` bypasses RLS, the function must re-implement the guard itself as its
  first statements: resolve `public.current_workshop_id()` into a local, raise if it is null, and
  raise unless `public.current_user_role() = 'owner'`. Stamp `workshop_id` on both inserts from that
  local — never from a parameter. Set `search_path = ''` and schema-qualify every reference, matching
  `handle_new_user()` / `seed_workshop_defaults()`. Let SQLSTATE `23P01` propagate untouched so the
  service layer can still branch on it. Grant `execute` to `authenticated` only.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate after the migration so `npm run typecheck` checks application code against the
new tables. `AGENTS.md` makes this mandatory after every migration and `.husky/pre-push` enforces it.

**Contract**: `npm run db:types` output, committed. Adds `appointments`, `customers` and the
`appointment_status` enum to the `Database` type.

#### 3. Shared entity types

**File**: `src/types.ts`

**Intent**: Re-export the new row types alongside the existing entity aliases so application code
never imports from `@/db/database.types` directly.

**Contract**: `Appointment`, `Customer`, `AppointmentStatus` following the existing alias pattern at
`src/types.ts:11-16`.

#### 4. pgTAP coverage

**File**: `supabase/tests/rls_workshop_scope.test.sql`

**Intent**: Extend the existing suite — this is "the regression net every downstream slice inherits"
per its own header comment. Two distinct properties need proving: that the new tables are
workshop-isolated like every table before them, and that the overlap guard actually rejects.

**Contract**: Bump the `plan(26)` count. Add, using the file's established
`pg_temp.authenticate_as` / `GET DIAGNOSTICS` idioms:

- Owner A cannot select owner B's appointments or customers (isolation).
- A worker's insert into `appointments` is denied — `throws_ok`, since a failing `WITH CHECK` aborts
  the statement (the file's own comment at the S-01 block explains this distinction versus `UPDATE`).
- A worker *can* select appointments in their own workshop (the S-03/S-04 precondition).
- A worker *can* update an appointment's status in their own workshop.
- Inserting an appointment overlapping an existing one on the same bay raises SQLSTATE `23P01`.
- Inserting a back-to-back appointment (`ends_at` of one equals `starts_at` of the next) **succeeds**
  — the `'[)'` bound regression test.
- Inserting an appointment overlapping one whose status is `no_show` **succeeds** — the partial-index
  regression test.
- A worker calling `book_appointment()` is rejected — `throws_ok`. `security definer` bypasses RLS,
  so this proves the in-function role check, not a policy, is holding the line.
- `book_appointment()` losing the race leaves no orphan customer: call it once, then call it again
  for the same bay and slot, and assert the second raises `23P01` **and** that
  `count(*) from customers` is unchanged — the rollback regression test.

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `npm run db:reset`
- pgTAP suite passes with the new assertions: `npm run db:test`
- Generated types are current: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio, both tables show RLS enabled with the expected per-operation policies.
- `select * from pg_extension where extname = 'btree_gist'` returns a row.
- Manually inserting two overlapping appointments on one bay via the SQL editor fails with
  `23P01`; the same insert on two different bays succeeds.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 2: Slot algorithm & Vitest

### Overview

Introduce the project's first JavaScript test runner and the pure function it exists to protect. No
Supabase, no I/O — inputs in, ranked slots out.

### Changes Required:

#### 1. Test toolchain

**File**: `package.json`, `vitest.config.ts`

**Intent**: Add Vitest as a dev dependency with a `test` script. Vitest is the natural fit because
the project already runs on Vite (Astro 6) and the `@` path alias must resolve identically in tests.

**Contract**: `vitest` in `devDependencies`; `"test": "vitest run"` and `"test:watch": "vitest"`
scripts. `vitest.config.ts` resolving `@` → `./src` to match `tsconfig.json`. Test files colocated
as `*.test.ts` next to the module under test. `eslint.config.js` may need the test glob added to its
ignore or override set if the type-checked rules complain about test files.

#### 2. Workshop clock helper

**File**: `src/lib/workshop-clock.ts`

**Intent**: Own the single timezone conversion the system needs. Workers run in UTC; every appointment
time is workshop-local wall-clock. This module answers "what is the wall-clock date and time in the
workshop right now, and what Postgres `dow` weekday is that" — and nothing else. Isolating it here is
what keeps timezone reasoning out of every other module.

**Contract**: Exports a `WORKSHOP_TIME_ZONE = "Europe/Warsaw"` constant and a function returning the
current workshop-local wall-clock as a naive `Date` (a `Date` whose UTC fields hold local wall-clock
values, so `getUTCDay()` yields the Postgres `dow` weekday directly). Implemented with
`Intl.DateTimeFormat` and `formatToParts` — the instant → local-parts direction, which needs no
dependency. Also exports the naive-`Date` ↔ Postgres `timestamp` string conversions the service layer
uses, so the wire format is defined in exactly one place.

Document at the top why the module exists and why the inverse conversion is deliberately absent.

#### 3. Slot suggestion algorithm

**File**: `src/lib/services/slot-suggestions.ts`

**Intent**: Given the day's window, the active bays, their busy intervals and a service duration,
produce the nearest free slots ranked by start time — rolling into the next open day when today
cannot supply enough. Pure and synchronous, so the edge matrix is testable without a database.

**Contract**: Builds on the sketch at `research.md:71-101`, with two deliberate changes from it:

- **Limit is 6, not 10** (`research.md:168` recommended 10). Six fills two chip rows on a 360px
  screen without scrolling; the brochure shows four in one row (`App.jsx:417`).
- **Multi-day.** The sketch searches a single window. This version accepts a sequence of day windows
  and walks them in order until the limit is reached, so a fully-booked today spills into the next
  open working day. Days with `is_closed` contribute no window.

Signature shape: takes the per-day windows (each carrying its calendar date), the active bays, busy
intervals keyed by bay, `durationMin`, the workshop-local `earliest` instant, and optional `stepMin`
(default 15) and `limit` (default 6). Returns `{ bayId, bayName, start, end }[]` sorted by start
then bay name.

Preserve two properties from the sketch: half-open overlap testing (`t < busy.end && t + dur >
busy.start`), and the cursor *jumping* past a colliding block (`t = ceil(busy.end / step) * step`)
rather than stepping through it.

#### 4. Algorithm tests

**File**: `src/lib/services/slot-suggestions.test.ts`

**Intent**: Cover the edge matrix that manual testing cannot reach. This function is the PRD's
hardest guardrail and the reason the test toolchain is being added at all.

**Contract**: Cases, at minimum:

- Empty day → slots start at the window open, spaced by `stepMin`.
- `earliest` mid-window → no slot starts before it, and the first is snapped up to the grid.
- A busy block → the cursor resumes on the grid at or after its end, never inside it.
- Back-to-back legality → a slot ending exactly when a busy block starts is offered.
- Service longer than the remaining window → no slot; in particular a slot may never end after
  `closes_at`.
- Service longer than the entire window → empty, not a partial or negative-length slot.
- Closed day (no window) → contributes nothing, no error.
- Multiple bays → results interleave by time and are ranked by start, then bay name.
- Today full → results come from the next supplied day window.
- Limit → exactly `limit` results when more are available.
- Zero active bays → empty result. Reachable in production, not merely defensive: `/ustawienia` lets
  an owner deactivate every bay.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build still succeeds with the new dev dependency: `npm run build`

#### Manual Verification:

- Reviewing the test list against the Contract above, no listed edge case is missing or trivially
  asserted.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Service layer, zod schemas & API routes

### Overview

Wire the algorithm to real data and expose two endpoints: one that suggests slots for a service, one
that books a chosen slot and translates a lost race into a recoverable 409.

### Changes Required:

#### 1. Validation schemas

**File**: `src/lib/schemas/appointment.ts`

**Intent**: Validate both request shapes at the API boundary, mirroring the conventions in
`src/lib/schemas/workshop-setup.ts` — Polish user-facing messages, cross-field checks via `.refine`.

**Contract**: A suggestion-request schema (`service_id` as uuid) and a booking-request schema
(`service_id`, `bay_id`, `starts_at`, and the walk-in customer's `first_name` + `phone`, both
required non-empty). `starts_at` is a naive wall-clock string, so validate it with a regex in the
same spirit as `TIME_HH_MM` (`workshop-setup.ts:39`) rather than `z.coerce.date()`, which would
apply UTC parsing semantics to a value that is not UTC. Export the inferred input types and re-export
them from `src/types.ts` as the existing schemas do.

#### 2. Appointment service

**File**: `src/lib/services/appointments.ts`

**Intent**: Fetch the algorithm's inputs and perform the booking. Follows
`src/lib/services/workshop-setup.ts` exactly: no function accepts a `workshop_id`; RLS scopes reads,
and inserts resolve the workshop through the `current_workshop_id` RPC (`workshop-setup.ts:52-56`).

**Contract**: Two exported functions.

*Suggest*: loads the service (for `duration_min`), active bays, all seven `working_hours` rows, and
existing appointments in the candidate date range excluding `cancelled`/`no_show`; builds day windows
from the workshop-local today forward — skipping `is_closed` days — and calls `suggestSlots`. Scan a
bounded horizon (14 days) so a workshop closed indefinitely terminates rather than looping.

An empty result is not an error, but the three ways of reaching it need different messages, so
*Suggest* returns `{ slots, emptyReason }` where `emptyReason` is `null` when slots exist and
otherwise one of `"no_active_bays"` (every bay deactivated), `"closed_all_week"` (no open day in the
horizon) or `"no_slots"` (open and staffed, but nothing fits in 14 days). Without this the owner sees
one indistinguishable "brak terminów" for a configuration mistake they could fix in `/ustawienia`.

*Book*: resolves the workshop id, inserts the `customers` row, then the `appointments` row with
`ends_at` derived server-side from `starts_at + duration_min`. **`ends_at` is never taken from the
request** — deriving it server-side is what stops a client from booking a zero-length appointment
that slips under the exclusion constraint. Re-read `duration_min` from the database for the same
reason.

**Re-validate the slot before inserting.** The exclusion constraint rejects overlaps only — it knows
nothing about `working_hours`, `is_closed` or `bays.is_active`. `bay_id` and `starts_at` arrive from
a chip the client may have held for minutes, during which `/ustawienia` can deactivate that bay
(`src/components/settings/Bays.tsx:24`) or shorten closing time. So *Book* re-runs the same
fetch-and-`suggestSlots` path *Suggest* uses and confirms the requested `(bay_id, starts_at)` pair is
present in the fresh result before inserting anything. If it is absent, return the **same 409 +
fresh-slot-list outcome** as the `23P01` case — the client already handles it. Relax `earliest` by
one `stepMin` on this path so a slot legitimately chosen seconds ago at the window edge is not
rejected for having aged. Without this, a stale chip books a row that holds the exclusion constraint
but sits on an inactive bay or outside working hours — invisible on S-03's bays × time grid while
blocking the slot.

Both inserts go through a single `supabase.rpc("book_appointment", …)` call, not two `.insert()`
calls. supabase-js has no client-side transaction, and two separate inserts would leave an orphan
`customers` row every time the appointment insert lost the race — which the Phase 4 retry loop makes
a routine path, not an exceptional one, and which Phase 1's deliberate absence of a `delete` grant
makes impossible to clean up afterwards. One function call is one implicit transaction, so the
customer insert rolls back with the appointment. `ends_at` is still computed in TypeScript from the
re-read `duration_min` and passed in; the function stamps `workshop_id` itself.

Surface the exclusion violation as a typed outcome rather than letting a raw `PostgrestError` reach
the route: detect SQLSTATE `23P01` and return a discriminated result the route can branch on. Per
`research.md:124`, the raw `DETAIL` must never leave the server.

#### 3. API routes

**File**: `src/pages/api/appointments/slots.ts`, `src/pages/api/appointments/index.ts`

**Intent**: Expose suggestion and booking. Uppercase exports, zod validation, `prerender = false`,
`locals.supabase` null-guard — the shape established by `src/pages/api/bays/index.ts`.

**Contract**:

- `slots.ts` — `POST` (a body, not a query string, keeps it consistent with every other route here
  and avoids caching semantics on a volatile result). Returns `{ slots: [...], emptyReason }`, `200`
  even when empty.
- `index.ts` — `POST`, returns `201` with the created appointment on success. On the `23P01`
  outcome, returns **`409` carrying a freshly-recomputed slot list** so the client can re-offer
  without the owner retyping the customer, with a generic Polish message ("Ten termin został właśnie
  zajęty"). Never include the constraint `DETAIL`.
- Both log server-side and return a generic `500` on unexpected failure, matching
  `bays/index.ts:22-25`.

#### 4. Route access rules

**File**: `src/lib/auth-guard.ts`

**Intent**: Declare the new API paths in the route table. `AGENTS.md` makes this mandatory — never
gate a route ad hoc — and the middleware answers a failed guard on `/api/*` with `401`/`403` JSON.

**Contract**: Add `["/api/appointments", "owner"]` to `ROUTE_ACCESS` (`auth-guard.ts:10-17`). The
prefix covers `/api/appointments/slots` via the existing `startsWith` match. Owner-only matches the
insert policy from Phase 1 and the PRD's Access Control split. When S-04 adds worker status changes it
will need a longer, more specific prefix — longest-prefix wins, so that will resolve correctly
without touching this entry.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing pgTAP suite still passes: `npm run db:test`

#### Manual Verification:

- `POST /api/appointments/slots` with a seeded service id returns 6 chronologically-ordered slots.
- Booking the first slot returns 201 and the row appears in Studio with `status = 'waiting'`.
- Re-posting the same slot returns 409 with a fresh, non-empty slot list and no second row.
- The 409 response body contains no constraint `DETAIL` or any other workshop's data.
- Signed in as a worker, both endpoints answer `403` JSON (not an HTML redirect).
- A day with `is_closed = true` contributes no slots; a workshop closed all week returns `[]`
  without hanging.
- Booking a stale slot is rejected: load slots, then deactivate that bay (or set the day
  `is_closed`) via `/ustawienia`, then post the held slot — the response is 409 with fresh slots,
  and no row is created.
- Deactivating every bay yields `emptyReason: "no_active_bays"`; closing every weekday yields
  `"closed_all_week"` — two distinguishable results, not one generic empty list.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: "Nowa wizyta" screen

### Overview

Build the screen, replicating the brochure's `AddVisitScreen` near-1:1 as `lessons.md:26` requires.

### Changes Required:

#### 1. Page route

**File**: `src/pages/wizyty/nowa.astro`

**Intent**: Server-render the shell and hand the React island the data it needs to render its first
paint without a fetch — the same pattern `src/pages/ustawienia.astro` uses.

**Contract**: Uses `AppShell` with `active="Dzisiaj"` and `title="Nowa wizyta"` (matching the
brochure's own `AppShell active="Dzisiaj" title="Nowa wizyta"` at `App.jsx:404`). Fetches active
services server-side and passes them to the island via `client:load`. Mirrors `ustawienia.astro:8`'s
null-`supabase` fallback. Guarded as owner-only — add `["/wizyty", "owner"]` to `ROUTE_ACCESS`.

#### 2. New-appointment island

**File**: `src/components/appointments/NewAppointmentForm.tsx`

**Intent**: The interactive flow: pick a service → slots load → pick a chip → fill name and phone →
save. Uses `useJsonMutation` from `src/components/hooks/useJsonMutation.ts` so a network rejection
can never escape as an unhandled promise.

**Contract**: Replicate `App.jsx:405-471` — the `rounded-[24px]` card, the header with its subtitle
"Tylko najważniejsze pola, bez zbędnego klikania", the orange `border-orange-200 bg-orange-50`
suggestion panel with its `Bell` icon and heading "System podpowiada najbliższe wolne terminy", the
chip row (selected chip `bg-orange-500 text-white`, others `bg-white text-orange-700`), the service
picker grid with its selected `border-orange-300 bg-orange-50` treatment, and the full-width
`bg-orange-500` submit button.

Three of the brochure's blocks are out of scope and their disposition is fixed here, not left to
judgment: omit "Opony" and "Notatka" (`:456-467`), and omit the **"Auto"** cell (`:437-440`, S-05).
The `md:grid-cols-2` field grid therefore carries three cells, not four — **Godzina** (read-only,
showing the chosen slot), **Telefon**, and **Klient** (the walk-in's first name, a real input where
the mockup shows static text). The header's `09:30–10:15` badge (`:410`) renders the selected slot's
span and is hidden until a chip is chosen.

Behaviour the mockup does not specify:

- Slots load when a service is selected; a service change clears the chosen slot, since a different
  duration invalidates it.
- Chips whose slot is not on the workshop-local today carry a short date label — the mockup shows
  times only because it assumes today.
- Submit is disabled until service, slot, name and phone are all present.
- On a 409, swap in the returned fresh slots, clear the chosen chip, keep the typed customer data,
  and show the server's message inline. This is what makes the race recoverable in one tap.
- On success, show a confirmation with the booked time and offer to add another. It cannot link to
  the day plan yet — S-03 does not exist.
- An empty slot list renders the message its `emptyReason` names, not a generic one:
  `no_active_bays` and `closed_all_week` point the owner at `/ustawienia` (the fix is theirs to
  make); `no_slots` just says nothing fits in the next two weeks.
- Use `cn()` from `@/lib/utils` for all conditional classes; never concatenate class strings.

#### 3. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Give the owner a way to reach the new screen. The dashboard already carries an
owner-only card linking to `/ustawienia` (`dashboard.astro:38-53`); this follows it.

**Contract**: An owner-only card or button linking to `/wizyty/nowa`. `AppShell` already supports a
header CTA via its `ctaLabel`/`ctaHref` props (`AppShell.astro:46-56`) — using it matches the
brochure's own header CTA treatment.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint` (React compiler and jsx-a11y rules included)
- Build succeeds: `npm run build`
- Unit tests still pass: `npm test`

#### Manual Verification:

- Side by side with `AddVisitScreen` in the brochure, the layout, spacing and colour treatment match
  on every in-scope block. The deliberate omissions are exactly three — "Opony", "Notatka", "Auto" —
  and nothing else differs.
- Booking end-to-end takes a few taps and the appointment appears in Studio with the right bay,
  times and `waiting` status.
- Changing the service after choosing a slot clears the selection and reloads suggestions.
- Forcing a 409 (book the same slot in a second browser tab first) keeps the typed name and phone,
  swaps the chips, and shows the message inline.
- At 360px the form is usable, buttons are large, and nothing overflows horizontally.
- A worker hitting `/wizyty/nowa` is redirected, not shown the form.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Ship

### Overview

Push the schema to production ahead of the merge, and clear the docs this slice invalidates.

### Changes Required:

#### 1. Stale documentation

**File**: `README.md`, `AGENTS.md`

**Intent**: Per `lessons.md:12`, a stale instruction in these files propagates into every downstream
slice, since they are the first thing a future agent reads.

**Contract**:

- `README.md` "Available Scripts" — add `npm test` / `npm run test:watch`. `AGENTS.md` points at
  README for all scripts, so this is the single place the new runner gets recorded.
- `README.md` "Auth routes" table — add `/wizyty/nowa` (owner-only) alongside `/ustawienia`.
- `AGENTS.md` "Build, Test, and Development Commands" — state that unit tests are Vitest,
  colocated as `*.test.ts`, and that pure business logic in `src/lib/services/` is expected to carry
  them. Without this a future slice will not know a runner exists.
- `AGENTS.md` "Hard Rules" or "Key conventions" — record the timezone contract: appointment times are
  naive workshop-local wall-clock (`timestamp`, not `timestamptz`), and `src/lib/workshop-clock.ts`
  is the only module permitted to convert. This is the highest-value line to add; without it a
  downstream slice will reach for `timestamptz` or `new Date()` and silently reintroduce the bug
  class this design eliminated.
- `grep -rn` for any doc text asserting the project has no test runner, and fix every hit.

#### 2. Roadmap sync

**File**: `context/foundation/roadmap.md`

**Intent**: The S-02 row and item body should reflect that this slice has left the backlog.

**Contract**: These edits were already made during planning — `:35` and `:122` read `planning`, and
both Unknowns at `:119-120` are already struck through with their resolutions (no "add now" escape
hatch; cap of 6 with next-day spill). The file is uncommitted, so all this phase owes is: bump
frontmatter `updated:` and commit it with the rest of the slice. The flip to `done` is
`/10x-archive`'s job, not this plan's.

#### 3. Ship sequence

**Intent**: Merging to `main` triggers a Cloudflare auto-deploy (`context/deployment/deploy-plan.md`,
~93s to live). Deploying a booking screen against a production database with no `appointments` table
breaks it. `lessons.md:5` records this exact failure from F-01.

**Contract**: Execute in this order, no step skipped:

1. Confirm the working tree is clean on `feat/add-appointment-with-slots` and all prior phases are
   committed.
2. `npm run db:reset && npm run db:test && npm test && npm run lint && npm run typecheck && npm run
   build` — full verification against a from-scratch database.
3. `npx supabase db push` — apply the migration to production.
4. In the production Supabase dashboard confirm: both tables exist with RLS enabled, `btree_gist` is
   installed, and `appointments_no_overlap_per_bay` is present —
   `select conname from pg_constraint where conrelid = 'public.appointments'::regclass;`
5. Insert two overlapping appointments by hand in the production SQL editor and confirm the second
   is rejected with `23P01`. Delete the test rows.
6. Merge `feat/add-appointment-with-slots` to `main` and let CI and the auto-deploy run.
7. After the deploy lands, sign in on production and book one real appointment through
   `/wizyty/nowa`.

Unlike S-01, this migration does not touch `handle_new_user()`, so the signup kill-switch is not in
play — the blast radius of a bad push is the new screen, not authentication.

### Success Criteria:

#### Automated Verification:

- Full local suite from scratch: `npm run db:reset && npm run db:test && npm test`
- Lint, typecheck, and build pass: `npm run lint && npm run typecheck && npm run build`
- Docs name the new script: `grep -n "npm test" README.md` returns a hit
- Docs name the timezone contract: `grep -rn "workshop-clock" AGENTS.md` returns a hit

#### Manual Verification:

- Production shows both tables with RLS enabled, `btree_gist` installed, and the exclusion constraint
  present.
- The hand-run overlap insert is rejected on production with `23P01`.
- After merge and deploy, a real appointment books successfully on production.
- The roadmap's S-02 row is committed with a bumped `updated:` (the `planning` edits already landed
  during planning).

**Implementation Note**: This is the final phase. Confirm the production checks by hand before
considering the change complete.

---

## Testing Strategy

### Unit Tests (Vitest, new in this change):

- `src/lib/services/slot-suggestions.test.ts` — the full edge matrix listed in Phase 2.
- The grid-snapping and cursor-jump behaviours, which are the two places an off-by-one hides.

### Database Tests (pgTAP, extending the existing suite):

- Workshop isolation on `appointments` and `customers`.
- Worker denied insert; worker permitted select and status update.
- Exclusion constraint rejects an overlap on the same bay (`23P01`).
- Back-to-back appointments accepted — the `'[)'` bound regression test.
- Overlap with a `no_show` appointment accepted — the partial-index regression test.

### Manual Testing Steps:

1. `npm run db:reset`, sign in as the seeded owner, open `/wizyty/nowa`.
2. Select "Wymiana + wyważanie" (45 min) and confirm 6 chronologically-ordered chips appear.
3. Book the first chip with a name and phone; confirm the row in Studio has the right bay, a 45-minute
   span, and `status = 'waiting'`.
4. Re-select the same service; confirm the booked slot is no longer offered.
5. Open a second tab, load suggestions in both, book the same slot in each — confirm the second gets a
   409, keeps its typed data, and re-offers fresh chips.
6. Set every weekday to `is_closed` in `/ustawienia`; confirm suggestions come back empty with a clear
   message and no hang.
7. Set today's closing time so under 45 minutes remain; confirm no slot is offered that would end
   after closing.
8. Resize to 360px and repeat the booking.
9. Sign in as a worker; confirm `/wizyty/nowa` redirects and both API routes answer `403` JSON.

## Performance Considerations

The suggestion path issues a small fixed number of Supabase reads (service, active bays, seven
working-hours rows, the horizon's appointments) and then runs entirely in memory. With 1–5 bays and a
day's appointments, the candidate set is trivial. The `(workshop_id, starts_at)` index serves the
range read, and S-03's day plan will reuse it.

The 14-day horizon bounds the worst case: a workshop closed every day terminates after scanning 14
empty windows rather than looping. The algorithm returns early once the limit is reached, so the
common case touches only today.

## Migration Notes

One new migration, no data migration — both tables are new. `create extension btree_gist` is
idempotent under `if not exists` and requires no elevated role on Supabase.

Rollback is asymmetric and worth stating plainly: `wrangler rollback` reverts the Worker but not the
schema. Since both tables are new and nothing existing reads them, a Worker rollback alone is a safe
recovery — the tables simply sit unused. Dropping them is never necessary as a rollback step.

S-05 will extend `customers` additively (last name, cars, search) rather than migrating data, which
is the reason the table exists in this slice rather than denormalized columns on `appointments`.

## References

- Research: `context/changes/add-appointment-with-slots/research.md` — build-vs-buy decision, the
  algorithm sketch (`:71-101`), the exclusion constraint (`:110-124`), timezone analysis (`:126-133`)
- Roadmap slice S-02: `context/foundation/roadmap.md:109-122`
- PRD: `context/foundation/prd.md` — US-01 (`:47-56`), FR-004/005 (`:73-77`), FR-009 (`:89-90`),
  guardrails (`:40-43`)
- Lessons: `context/foundation/lessons.md:5` (migration before merge), `:12` (grep the docs),
  `:26` (replicate the brochure)
- RLS pattern to copy: `supabase/migrations/20260814235519_role_and_workshop_scope.sql:73-102`
- Service-layer pattern: `src/lib/services/workshop-setup.ts:52-68`
- API route pattern: `src/pages/api/bays/index.ts`
- Client mutation pattern: `src/components/hooks/useJsonMutation.ts`
- Prior slice for phase shape and ship sequence: `context/archive/2026-08-15-workshop-setup/plan.md`
- Brochure `AddVisitScreen`: `wulkanizator-go-brochure/src/App.jsx:402-473`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RLS & the overlap guard

#### Automated

- [x] 1.1 Migration applies from scratch: `npm run db:reset` — 4443a01
- [x] 1.2 pgTAP suite passes with the new assertions: `npm run db:test` — 4443a01
- [x] 1.3 Generated types are current: `npm run db:types && git diff --exit-code src/db/database.types.ts` — 4443a01
- [x] 1.4 Type checking passes: `npm run typecheck` — 4443a01
- [x] 1.5 Linting passes: `npm run lint` — 4443a01

#### Manual

- [x] 1.6 Both tables show RLS enabled with the expected per-operation policies in Studio
- [x] 1.7 `btree_gist` is installed
- [x] 1.8 Overlapping insert on one bay fails with `23P01`; same insert across two bays succeeds

### Phase 2: Slot algorithm & Vitest

#### Automated

- [x] 2.1 Test suite passes: `npm test` — 517166b
- [x] 2.2 Type checking passes: `npm run typecheck` — 517166b
- [x] 2.3 Linting passes: `npm run lint` — 517166b
- [x] 2.4 Build succeeds with the new dev dependency: `npm run build` — 517166b

#### Manual

- [x] 2.5 No edge case from the Phase 2 contract is missing or trivially asserted

### Phase 3: Service layer, zod schemas & API routes

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — a1e44d6
- [x] 3.2 Linting passes: `npm run lint` — a1e44d6
- [x] 3.3 Build succeeds: `npm run build` — a1e44d6
- [x] 3.4 Existing pgTAP suite still passes: `npm run db:test` — a1e44d6

#### Manual

- [x] 3.5 Slots endpoint returns 6 chronologically-ordered slots for a seeded service
- [x] 3.6 Booking returns 201 and the row appears with `status = 'waiting'`
- [x] 3.7 Re-posting the same slot returns 409 with fresh slots and no second row
- [x] 3.8 The 409 body leaks no constraint `DETAIL` or other-workshop data
- [x] 3.9 A worker gets `403` JSON (not an HTML redirect) from both endpoints
- [x] 3.10 A closed day yields no slots; a fully-closed workshop returns `[]` without hanging
- [x] 3.11 A stale slot (bay deactivated or day closed after the chips loaded) is rejected with 409 and creates no row
- [x] 3.12 Zero active bays and a fully-closed week return distinguishable `emptyReason` values

### Phase 4: "Nowa wizyta" screen

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck` — 55e4e27
- [x] 4.2 Linting passes: `npm run lint` — 55e4e27
- [x] 4.3 Build succeeds: `npm run build` — 55e4e27
- [x] 4.4 Unit tests still pass: `npm test` — 55e4e27

#### Manual

- [x] 4.5 Layout, spacing and colour match the brochure's `AddVisitScreen` on every in-scope block; the only omissions are "Opony", "Notatka", "Auto"
- [x] 4.6 End-to-end booking lands the right bay, times and `waiting` status
- [x] 4.7 Changing service clears the chosen slot and reloads suggestions
- [x] 4.8 A forced 409 keeps typed data, swaps chips, and shows the message inline
- [ ] 4.9 Usable at 360px with no horizontal overflow
- [x] 4.10 A worker is redirected away from `/wizyty/nowa`

### Phase 5: Ship

#### Automated

- [x] 5.1 Full local suite from scratch: `npm run db:reset && npm run db:test && npm test`
- [x] 5.2 Lint, typecheck, and build pass
- [x] 5.3 Docs name the new script: `grep -n "npm test" README.md`
- [x] 5.4 Docs name the timezone contract: `grep -rn "workshop-clock" AGENTS.md`

#### Manual

- [ ] 5.5 Production shows both tables with RLS, `btree_gist`, and the exclusion constraint
- [ ] 5.6 Hand-run overlap insert rejected on production with `23P01`
- [ ] 5.7 A real appointment books successfully on production after deploy
- [ ] 5.8 The roadmap's S-02 edits are committed with a bumped frontmatter `updated:`
