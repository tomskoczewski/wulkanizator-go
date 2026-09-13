---
date: 2026-09-12T12:31:21Z
researcher: tomaszskoczewski
git_commit: 674a1254a7c684b5494b83d0cfe53688e55c528b
branch: main
repository: wulkanizator-go
topic: "Deep Focus on the appointment booking flow — feature overview and technical debt"
tags: [research, codebase, booking, appointments, slot-suggestions, rls, invariants]
status: complete
last_updated: 2026-09-12
last_updated_by: tomaszskoczewski
---

# Research: the appointment booking flow

**Date**: 2026-09-12T12:31:21Z · **Researcher**: tomaszskoczewski
**Git commit**: `674a125` · **Branch**: `main` · **Repository**: `wulkanizator-go`

**Goal (one line)**: trace and audit the booking flow from `src/components/appointments/NewAppointmentForm.tsx`
to `book_appointment()` in Postgres, because `context/map/repo-map.md` §4 named it **risk zone #1** —
one invariant with two independent implementations that git shows have never moved together.

**Evidence discipline.** Every finding is labelled **[E] evidence** (a line was read or a command was
run — the command is given), **[I] inference** (reasoned from evidence, not observed), or
**[U] unknown** (could not be confirmed; what it would take is stated). Counts without a command are
not counts.

---

## Research Question

How does booking an appointment actually work end-to-end, what enforces the booking rules, what is
tested, and what has to change together when this flow changes? Explicitly **not** in scope: designing
a refactor. This is a description of the repository as it stands at `674a125`.

Method: three parallel sub-agents (end-to-end trace / test coverage / blast radius), each required to
return `file:line` and a claim ledger, cross-checked against the two prior map artifacts and re-verified
in the main session on the load-bearing claims.

---

## Summary

Booking is a **deliberate check-then-act**, and the design is more coherent than the map suggested. The
server does not trust the client's slot: `bookAppointment()` recomputes the whole suggestion list and
requires the requested `(bay_id, starts_at)` pair to still be on it before touching the database
(`src/lib/services/appointments.ts:185-192`) **[E]**. `ends_at` never comes from the client — it is
derived from the server-side service duration (`:194-195`) **[E]**. Postgres then owns exactly one
thing: the race. An exclusion constraint rejects an overlapping insert, the service maps SQLSTATE
`23P01` to a conflict, and the route answers `409` with a **freshly recomputed** slot list that the
island swaps in (`appointments.ts:206-212`, `api/appointments/index.ts:22-33`,
`NewAppointmentForm.tsx:116-123`) **[E]**. That is a good pattern, honestly executed.

The debt is not where the map guessed. The map called risk zone #1 "one invariant, two
implementations". The precise finding is sharper and different: **the two implementations enforce
different, complementary subsets of the rules, and the subset that exists only in TypeScript has no
database backstop and no test at any layer.** Postgres enforces identity, workshop ownership, and
non-overlap. Working hours, closed days, the 15-minute grid, "not in the past" and the 14-day horizon
live _only_ in the untested preflight. Separately — and this is the finding with the hardest evidence —
**no commit in this repository's history has ever changed the behaviour of both sides of the shared
rule together** (`comm -12` over the two commit sets → empty) **[E]**.

Maps to the module-4 report as **② Feature overview** and **③ Technical debt** below.

---

## Feature overview

### What it does

An owner opens `/wizyty/nowa`, picks a service, receives up to six suggested free slots across the next
14 days, picks one, types a customer's first name and phone, and submits. The system creates (or reuses)
a customer and books the appointment with status `waiting`. Two appointments can never occupy one bay at
overlapping times.

### Entry and access

| Step                | Where                                                  | What happens                                                                                                                      |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Request enters      | `src/middleware.ts:7-23`                               | Cookie-backed Supabase SSR client; `auth.getUser()`; RLS-scoped `profiles` read attaches `locals.user` / `locals.profile` **[E]** |
| Fail-closed anomaly | `src/middleware.ts:25-41`                              | Authenticated but no profile row → sign out; `401` JSON for `/api/*`, redirect for pages **[E]**                                  |
| Guard               | `src/middleware.ts:52` → `src/lib/auth-guard.ts:14,19` | Longest-prefix route table: `/wizyty/nowa` → `owner`, `/api/appointments` → `owner` **[E]**                                       |
| Page render         | `src/pages/wizyty/nowa.astro:8,14`                     | `getWorkshopConfiguration()` (workshop, active bays, active services, hours) then mounts the island **[E]**                       |

### The flow

**Suggest** — island → `POST /api/appointments/slots` (the endpoint exports `POST` only, there is no
`GET` **[E]**):

1. `slots.ts:9-17` — 503 without a Supabase client; body parsed; `slotSuggestionRequestSchema` requires a
   trimmed UUID `service_id` **[E]**.
2. `appointments.ts:82-86` — `getWorkshopNow()` gives naive workshop-local "now"; truncated to a date;
   horizon `+14` days (`HORIZON_DAYS`, `:27`) **[E]**.
3. `appointments.ts:88-98` — four parallel RLS-scoped reads: service `duration_min`, active bays, all
   `working_hours`, and appointments in `[today, today+14)` **excluding `cancelled`/`no_show`** (`:95`) **[E]**.
4. `appointments.ts:107-117` — one window per open day; `date.getUTCDay()` yields the Postgres `dow`
   directly; `combineDateAndTime` splices `opens_at`/`closes_at` **[E]**.
5. `slot-suggestions.ts:48-87` — pure walk: cursor snapped to a 15-minute grid from
   `max(window.start, earliest)`, half-open collision test at `:65`, sort by start then bay name, cap at
   6 **[E]**.
6. `appointments.ts:147-163` — an empty result is not an error; it carries an `emptyReason` of
   `no_active_bays` / `closed_all_week` / `no_slots`, which the island renders as three distinct
   messages **[E]**.
7. `appointments.ts:49-56` (`toWireSlot`) — each `Date` is serialized in exactly the format
   `STARTS_AT_PATTERN` validates, so the client can echo the slot back verbatim **[E]**.

**Book** — island → `POST /api/appointments`:

8. `index.ts:14-17` — `appointmentBookingRequestSchema`: UUID `service_id`/`bay_id`, `starts_at` matched
   against a **regex, deliberately not `z.coerce.date()`** (which would apply UTC semantics to a zoneless
   value — comment at `schemas/appointment.ts:4-6`), non-empty `first_name`/`phone`. **No `ends_at`
   field exists** **[E]**.
9. `appointments.ts:182-192` — **preflight**: recompute suggestions with `earliest = now − 15 min` (so a
   slot chosen seconds ago at a window edge is not rejected for having aged), then require the exact
   `(bay_id, start)` to still be offered. Not offered → conflict **without touching the database** **[E]**.
10. `appointments.ts:194-204` — `ends_at = starts_at + durationMin` from the server-side row; both times
    re-serialized by `naiveDateToTimestampString`; `rpc("book_appointment", …)` **[E]**.
11. `20260825120100_book_appointment_dedupe_customer.sql:42-58` — four guards inside the
    `security definer` function: workshop resolved, role is `owner`, bay belongs to this workshop,
    service belongs to this workshop. `workshop_id` is stamped from the resolved local, never from a
    parameter **[E]**.
12. Same file `:60-84` — `insert … on conflict (workshop_id, phone_normalized) where (length(…) >= 9)
do nothing`, then oldest-wins re-select. Repeat customers are reused, never overwritten **[E]**.
13. `20260821090000_appointments_and_customers.sql:56-61` — the appointment insert meets
    `appointments_no_overlap_per_bay`: `exclude using gist (bay_id with =, tsrange(starts_at, ends_at,
'[)') with &&) where (status not in ('cancelled','no_show'))`. Both inserts share one implicit
    transaction, so a lost race leaves no orphan customer **[E]**.
14. `appointments.ts:206-212` → `index.ts:22-33` — `23P01` becomes `409` with a fresh slot list; the raw
    constraint DETAIL is deliberately never forwarded because it names the conflicting row and is
    produced before RLS filtering **[E]**.
15. `index.ts:35` → `NewAppointmentForm.tsx:111-114,144-163` — `201` returns the appointment row; the
    island shows a success card. **There is no navigation** — the only exit is "Dodaj kolejną wizytę",
    which resets the form in place **[E]**.

```mermaid
sequenceDiagram
    autonumber
    participant I as NewAppointmentForm (island)
    participant M as middleware + auth-guard
    participant A as /api/appointments{,/slots}
    participant Z as zod
    participant S as appointments.ts / slot-suggestions.ts
    participant P as Postgres (RLS + book_appointment)

    I->>M: POST /api/appointments/slots {service_id}
    M->>M: getUser + profiles; requireRole → owner
    M->>A: next()
    A->>Z: slotSuggestionRequestSchema
    A->>S: suggestSlotsForService()
    S->>P: duration_min | active bays | working_hours | appointments[today,+14d)
    P-->>S: rows (RLS-scoped)
    S->>S: day windows + busyByBay → 15-min grid walk, limit 6
    A-->>I: 200 {slots, emptyReason}

    I->>M: POST /api/appointments {service_id, bay_id, starts_at, first_name, phone}
    M->>A: requireRole → owner
    A->>Z: appointmentBookingRequestSchema (regex, no Date coercion)
    A->>S: bookAppointment()
    S->>S: PREFLIGHT — recompute; is (bay, start) still offered?
    S->>S: ends_at = starts_at + server-side durationMin
    S->>P: rpc book_appointment(...)
    P->>P: guards: workshop, role, bay, service
    P->>P: customers upsert-by-phone; insert appointment (status waiting)
    P->>P: exclusion constraint decides the race
    P-->>S: row  |  23P01
    S-->>A: created  |  conflict + fresh slots
    A-->>I: 201 row  |  409 {error, slots, emptyReason}
```

### Where each rule is actually enforced

This table is the heart of the analysis — it is what the map could not see.

| Rule                                                  | TypeScript                                       | Postgres                                  | Backstop if TS is bypassed?         |
| ----------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- | ----------------------------------- |
| No two appointments on one bay at overlapping times   | `slot-suggestions.ts:65` (suggestion side)       | `20260821090000:56-61` (authority)        | ✅ **Yes** — the constraint decides |
| `cancelled` / `no_show` release the slot              | `appointments.ts:95`                             | same constraint's partial `where` (`:61`) | ✅ Yes                              |
| Bay / service belong to the caller's workshop         | — (RLS-scoped reads only)                        | `20260825120100:52-58`                    | ✅ Yes                              |
| Only an owner may book                                | `auth-guard.ts:19`                               | `20260825120100:48-50`                    | ✅ Yes, twice                       |
| `ends_at > starts_at`                                 | derived, `:194-195`                              | check constraint `20260821090000:45`      | ✅ Yes                              |
| **Inside working hours**                              | `appointments.ts:107-117` + preflight `:185-192` | **nothing**                               | ❌ **No**                           |
| **Not on a closed day**                               | `appointments.ts:112`                            | **nothing**                               | ❌ **No**                           |
| **On the 15-minute grid**                             | `slot-suggestions.ts:62`                         | **nothing**                               | ❌ **No**                           |
| **Not in the past**                                   | `earliest` / `relaxedEarliest`, `:182`           | **nothing**                               | ❌ **No**                           |
| **Within the 14-day horizon**                         | `HORIZON_DAYS`, `:27`                            | **nothing**                               | ❌ **No**                           |
| **`ends_at − starts_at` equals the service duration** | `:194-195`                                       | **nothing**                               | ❌ **No**                           |

`grep -rn "working_hours"` over the three appointment migrations returns nothing **[E]**.

### Time handling

Every conversion on this path goes through `src/lib/workshop-clock.ts` — the single
`Intl.DateTimeFormat` in `src/` lives at `:17-26` **[E]**. Times are naive workshop-local wall-clock: a
`Date` whose **UTC** fields hold Warsaw local values, so `getUTCDay()` returns the Postgres `dow`
directly. Everything else on the path is either `Date.UTC` construction or epoch-ms arithmetic
(`appointments.ts:70-79,83-85,195`; the entire `slot-suggestions.ts` walk) — no local-field accessor
anywhere **[E]**. The database matches: `timestamp` not `timestamptz`, `tsrange` not `tstzrange`
(`20260821090000:41-42,60`) **[E]**. The island only ever slices strings for display
(`NewAppointmentForm.tsx:49-61`) **[E]**.

### Error paths

| Failure                                                      | Where                                  | Response                             | What the user sees                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| No Supabase client                                           | `index.ts:9-11`, `slots.ts:9-11`       | `503 {error}`                        | Generic "Coś poszło nie tak" **[E]**                                                                                         |
| Zod rejection                                                | `index.ts:14-17`                       | `400 {errors: fieldErrors}`          | **Generic message only** — `handleSubmit` has no 400 branch and discards `errors` (`NewAppointmentForm.tsx:111-125`) **[E]** |
| Unauthenticated / wrong role on `/api/*`                     | `middleware.ts:54-59`                  | `401` / `403` JSON, never a redirect | Generic message **[E]**                                                                                                      |
| Slot no longer offered (bay deactivated, hours shortened)    | `appointments.ts:190-192`              | `409 {error, slots, emptyReason}`    | Chips re-render from the server's fresh list; selection cleared **[E]**                                                      |
| Lost race, `23P01`                                           | constraint → `appointments.ts:207-210` | same `409` shape                     | Same **[E]**                                                                                                                 |
| RPC guard `raise exception` (foreign bay/service, not owner) | `20260825120100:45,49,53,57`           | rethrown → `500 {error}`             | Generic message **[E]**                                                                                                      |
| Network failure                                              | `NewAppointmentForm.tsx:126-127`       | —                                    | "Nie udało się połączyć z serwerem." **[E]**                                                                                 |

---

## Technical debt

Ordered by how expensive a mistake would be, not by how ugly the code is. Cheap debt that CI already
catches is listed separately at the end, so it does not compete for attention.

### TD-1 · The shared rule is written twice and has never been edited together — [E]

The no-overlap invariant exists in two languages:

| Aspect                   | TypeScript                                                                             | Postgres                                                          |
| ------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Half-open `[start, end)` | `slot-suggestions.ts:65` — `cursor < +block.end && cursor + durationMs > +block.start` | `20260821090000:60` — `tsrange(starts_at, ends_at, '[)') with &&` |
| Per bay                  | `slot-suggestions.ts:59-60`                                                            | `:59` — `bay_id with =`                                           |
| Status exclusion         | `appointments.ts:95` — `.not("status","in","(cancelled,no_show)")`                     | `:61` — `where (status not in ('cancelled','no_show'))`           |

The two sides are joined by **exactly one runtime token**: the SQLSTATE literal `"23P01"` at
`appointments.ts:207`. There is no shared schema, no codegen, no test that runs both.
`slot-suggestions.ts` has fan-out **0** — it imports nothing, including anything that knows the
constraint exists. The only cross-reference is a prose comment (`slot-suggestions.ts:9-11`).

The history is unambiguous:

```bash
comm -12 <(git log --format='%H' -- src/lib/services/slot-suggestions.ts | sort) \
         <(git log --format='%H' -- supabase/migrations/ | sort)      # → empty
```

Zero commits. Widening the TypeScript side to `appointments.ts` yields exactly one commit, `f91e4d5`,
whose SQL diff is **five added comment lines** ("superseded, see the newer migration") — not a rule
change **[E]**. The two implementations were even written on the same day, one commit apart (`4443a01`
created the constraint, `517166b` created the algorithm) and still did not touch **[E]**.

**Why it matters.** Adding a buffer between jobs, or making `cancelled` re-occupy its slot, means editing
`slot-suggestions.ts:65`, `appointments.ts:95`, the migration `:56-61`, and pgTAP `:453-495` + `:730-750`.
Nothing connects those four places — not the import graph, not the type system, not lefthook, not CI **[I]**.
Drift fails **open** (a slot is offered that Postgres rejects — degraded to a mysterious "termin właśnie
zajęty") or **closed and silent** (a legal slot is never offered; no error, no failing test) **[I]**.

### TD-2 · Six rules exist only in an untested TypeScript preflight — [E]

Per the enforcement table above, working hours, closed days, grid alignment, "not in the past", the
14-day horizon and the duration↔`ends_at` relation have **no database backstop**. Their single point of
enforcement is `bookAppointment()`'s preflight (`appointments.ts:185-192`) — and `bookAppointment()`
**has no unit test at any layer**; only the happy path is exercised, by `e2e/core-loop.spec.ts:31-52` **[E]**.
Delete the preflight and the entire suite still passes **[I]**.

**Severity, stated honestly.** `book_appointment()` is granted to `authenticated`
(`20260821090000:159-160`) and its own guards do not check time **[E]** — but `SUPABASE_URL` and
`SUPABASE_KEY` are declared `context: "server", access: "secret"` (`astro.config.mjs:19-20`) and no island
imports the Supabase client **[E]**, so today nothing ships the credentials needed to call the RPC
directly from a browser. This is therefore **defence-in-depth missing, not an open hole** — the property
is invisible to every test and one client-side integration away from mattering **[I]**.

### TD-3 · The API layer has no tests, and the 409 contract is untested on both ends — [E]

```bash
find src/pages/api -name "*.ts" | wc -l       # 12
find src/pages/api -name "*.test.ts" | wc -l  # 0
```

Nothing asserts the `503` / `400` / `409` / `500` mapping in `index.ts`. The 409 body — the one response
carrying `slots` and `emptyReason` alongside the error — is produced by untested code
(`index.ts:22-33`) and consumed by untested code (`NewAppointmentForm.tsx:116-123`, which has no
colocated test) **[E]**. Invert the conflict mapping and every test stays green **[I]**. This is exactly
the gap `context/foundation/test-plan.md:105-110` calls Phase 1, whose change folder
(`context/changes/testing-api-contract-harness/`) is an empty stub that **no commit has ever touched** **[E]**.

### TD-4 · The booking submit bypasses the shared HTTP path — [E]

`ast-grep --pattern 'fetch($$$)'` over `src` returns exactly two call sites: the shared hook
(`useJsonMutation.ts:42`) and the booking submit (`NewAppointmentForm.tsx:98`). A plain `grep` including
`.astro` returns the same two, so the zero elsewhere is real, not a bad pattern **[E]**. The bypass is
deliberate and documented (`NewAppointmentForm.tsx:88-90`: the 409 carries slots alongside the error, and
folding it onto the helper was left as a separate change) — and the comment now understates the hook,
which since then carries `status` and `body` on its failure type **[E]**. Cost: the most interesting
response on the whole path is handled by the one code path that shares nothing with the other seven
callers **[I]**. Note this refines `context/map/artifact-2-structure.md`, which called `useJsonMutation`
_the_ single HTTP path for island mutations.

### TD-5 · The service test's Supabase fake cannot see query construction — [E]

`src/lib/services/appointments.test.ts` despite its name tests **only** `changeAppointmentStatus`; it
contains no assertion about `bookAppointment`, `suggestSlotsForService` or `toWireSlot` **[E]**. Its fake
(`:31-48`) is a self-referential chain cast `as unknown as TypedSupabaseClient`, so `eq()` and `select()`
ignore their arguments: the table name, the column list and the compare-and-set predicate are all
unverifiable. Removing `.eq("status", input.from)` from the status update would leave the suite green **[I]**.
The generated `database.types.ts` contributes nothing through that double cast **[E]**.

### TD-6 · One line in the pgTAP suite is a file-global write lock — [E]

`supabase/tests/rls_workshop_scope.test.sql:11` is `select plan(54 + 12)`. pgTAP needs the assertion count
up front, so adding or removing a single assertion anywhere in the 765-line file forces an edit to line 11.
That is why artifact 1 measured 821 lines of churn over only 8 commits on this one file **[E]**. Booking
work touches it constantly: it appears in **5 of the 15** commits that touch any booking-path file **[E]**.

### TD-7 · The busy-interval query filters on `starts_at` only — [I]

`appointments.ts:96-97` selects appointments with `starts_at >= today AND starts_at < today+14d`. An
appointment that **started before** the window but **ends inside** it is therefore absent from
`busyByBay`, so the suggester could offer a slot the constraint then rejects **[I]**. Reachability
depends on whether an appointment can span midnight, which depends on working hours — not established
here **[U]**. Named because the failure mode is the user-visible one: a suggested slot that 409s for no
explicable reason.

### TD-8 · Field-level validation errors never reach the user on this path — [E]

`index.ts:16` returns `{errors: fieldErrors}` per field, and `handleSubmit` has no 400 branch — every
non-201, non-409 status collapses to "Coś poszło nie tak. Spróbuj ponownie."
(`NewAppointmentForm.tsx:125`) **[E]**. Low severity today: the UI cannot easily produce an invalid
payload, since the slot and service ids come from the server's own responses **[I]**.

### Cheap debt — real, but already mechanically caught

- **`src/db/database.types.ts` regeneration.** 9 migration commits, 4 of which also touched the generated
  file, every diff purely additive (`-0` deletions) **[E]**. Regeneration is triggered by tables, columns,
  enums and _function signatures_ — not by bodies, grants or policies: `book_appointment()` was rewritten
  twice with zero change to the file, because `create or replace` kept the six-argument signature **[E]**.
  This is the cheap kind of coupling: mandatory, satisfied by one command, and gated by
  `lefthook.yml:22-37` pre-push. One caveat — the gate exits 0 when the local Supabase stack is down
  (`:26-29`), so drift can be pushed from a machine without Docker **[E]**.
- **Type-only cycles through `src/types.ts`.** Real for readability, zero at runtime, and no test can
  ever fail on them (see `context/map/artifact-2-structure.md` §1).

### Blast radius — what must change together

| Layer                                     | What moves                                                                                                  | How we know                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript importers of `appointments.ts` | 3 API routes + its test, **plus `dashboard.astro:4` and `wizyty/[id].astro:5`**                             | graph fan-in 5, `.astro` edges recovered by grep — the graph cannot see them **[E]**             |
| Route access                              | `src/lib/auth-guard.ts:19-20` holds the paths as **string literals**                                        | present in **5 of 15** booking commits; structurally unrepresentable in any import graph **[E]** |
| Postgres                                  | `book_appointment()` + the constraint + RLS policies across 4 migrations                                    | `file:line` map in the ledger below **[E]**                                                      |
| Proof                                     | `rls_workshop_scope.test.sql` blocks `:453-495`, `:501-526`, `:541-558`, `:573-661`, `:730-750`, plus `:11` | **5 of 15** booking commits **[E]**                                                              |
| Generated                                 | `src/db/database.types.ts` — only on a shape change                                                         | 4 of 9 migration commits **[E]**                                                                 |
| Process                                   | `context/changes/**` — **100%** of the 15 booking commits                                                   | matches artifact 1 §3 **[E]**                                                                    |
| `.astro` pages                            | `dashboard.astro` appears in **3 of 15**                                                                    | git only; graph blind **[E]**                                                                    |

`slot-suggestions.ts` is the cheapest module on the path to change — fan-out 0, one production
dependent **[E]**. Its Postgres twin is not (TD-1).

---

## Code References

- `src/components/appointments/NewAppointmentForm.tsx:88-98` — the documented `fetch` bypass; `:111-125` response handling; `:116-123` the 409 resync
- `src/components/hooks/useJsonMutation.ts:36-66` — shared request path and failure shape
- `src/pages/api/appointments/index.ts:9-39` — the whole booking route
- `src/pages/api/appointments/slots.ts:8-27` — `POST`-only suggestion route
- `src/lib/schemas/appointment.ts:4-19` — `STARTS_AT_PATTERN` and the booking schema (no `ends_at`)
- `src/lib/services/appointments.ts:81-131` inputs · `:140-176` suggestion · `:178-215` booking · `:95` status filter · `:207` the `23P01` seam
- `src/lib/services/slot-suggestions.ts:48-87` — the pure walk; `:65` the overlap test
- `src/lib/workshop-clock.ts:15-60` — the only clock
- `src/lib/auth-guard.ts:14,19` — `/wizyty/nowa` and `/api/appointments` as owner-only string literals
- `supabase/migrations/20260821090000_appointments_and_customers.sql:41-46` columns · `:56-61` the constraint · `:68-101` RLS · `:159-160` the execute grant
- `supabase/migrations/20260821150000_book_appointment_ownership_check.sql:41-47` — cross-workshop fix
- `supabase/migrations/20260825120100_book_appointment_dedupe_customer.sql:42-90` — the live RPC
- `supabase/tests/rls_workshop_scope.test.sql:11` the plan line · `:453-495` overlap · `:501-526` race/no-orphan · `:541-558` cross-workshop · `:573-661` dedupe · `:730-750` no-show release
- `e2e/core-loop.spec.ts:31-52` — the only end-to-end booking assertion

## Architecture Insights

- **The database owns the race; the application owns the shape.** That split is deliberate and stated in
  the migration's own comment (`20260821090000:9-11`): a check-then-insert in the API loses to two
  simultaneous requests. What was never decided is who owns the _shape_ rules — they landed in TypeScript
  by default, not by argument **[I]**.
- **Naive wall-clock is implemented with unusual discipline.** One conversion module, one `Intl` call, no
  local-field accessors anywhere on the path, `timestamp`/`tsrange` matching end to end. The weakness is
  not the design but that nothing executable enforces it (no lint rule, no test on `workshop-clock.ts`).
- **The API routes are a uniform surface — with a named exception.** `index.ts` and `slots.ts` have an
  identical import shape and identical error scaffolding, and structural verification found the same
  single-uppercase-handler shape in all 12 route files. But only **9 of 12** validate with zod: the three
  auth routes read `formData()` and cast (`api/auth/signin.ts:5-7`), which is a documented `AGENTS.md`
  rule they do not follow (see the verification table below) **[E]**. A route-level harness would still
  pay for itself once and cover the nine **[I]**.
- **`.astro` invisibility is not academic here.** It hid a real dependent of the booking service
  (`dashboard.astro`) and produced a false "dead module" verdict on `schemas/day-plan.ts`, which
  `dashboard.astro:5` imports (`resolveDayParam`) — closing open question #6 from artifact 2 **[E]**.

## Historical Context (from prior changes)

- `context/archive/2026-08-21-add-appointment-with-slots/` — the slice that built this flow; its
  `reviews/impl-review.md` found the cross-workshop bay-squatting hole that `20260821150000` fixes.
- `context/archive/2026-08-25-customer-dedupe-on-booking/` — replaced the unconditional customer insert
  with the `on conflict` reuse path now in the RPC.
- `context/foundation/lessons.md` — "A `security definer` RPC that unconditionally inserts accumulates a
  row on every successful call", including its 2026-08-25 correction: the two inserts share one
  transaction, so a lost race leaves no orphan (asserted at `rls_workshop_scope.test.sql:501-526`).
- `context/foundation/test-plan.md:95-120` — Phase 1 (API contract harness) is `not started`; Phase 2
  (booking invariants) landed its pgTAP half only, with the working-hours case explicitly outstanding.

## Related Research

- `context/map/repo-map.md` — risk zone #1 (refined here), zones #3–#4 (confirmed)
- `context/map/artifact-2-structure.md` — fan-in/fan-out priors; its open question #6 is answered above
- `context/archive/2026-08-21-add-appointment-with-slots/research.md` — why no slot library was adopted

## Open Questions — [U]

1. Can an appointment span midnight under any working-hours configuration? Decides whether TD-7 is
   reachable or theoretical.
2. Does `services.duration_min` carry a positivity constraint? If not, a zero/negative duration would meet
   only the `ends_after_starts` check.
3. What does PostgREST actually return for the naive `timestamp` in the 201 body? Both sides were read;
   no response was observed.
4. Is the `.astro` recovery complete? Only top-level `import` lines were grepped — a page calling a
   service inside its frontmatter body, or hitting an endpoint by URL string, is still invisible.
5. Does the e2e suite currently pass? Not run here; it needs the local Supabase stack and writes rows.

---

## Structural verification (ast-grep)

Every structural claim in this report — counts, "only here", "always through X" — was re-derived with
`ast-grep` rather than trusted. Per the rule for this step, **every zero was re-confirmed with a plain
`grep`**, because a zero from a structural matcher is ambiguous between "no occurrences" and "bad
pattern". `ast-grep` shares this repo's blind spot: it cannot parse `.astro`, so it sees 59 of 73 source
files — the grep backstops below deliberately include `--include="*.astro"`.

| #   | Claim                                                                         | Pattern                                                                     | Result                                                                                                         | Verdict                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Only `workshop-clock.ts` converts between an instant and workshop-local parts | `new Intl.DateTimeFormat($$$)`                                              | **1** — `src/lib/workshop-clock.ts:17`                                                                         | ✅ confirmed                                                                                                                                                                                                                                      |
| C2  | No local-field `Date` accessor anywhere in `src/`                             | `$D.getHours()`, `.getDate()`, `.getDay()`, `.getMonth()`, `.getFullYear()` | **0** each; grep over `*.ts,*.tsx,*.astro` for those five plus `.getMinutes()`/`.getSeconds()` → **0**         | ✅ confirmed (zeros backstopped)                                                                                                                                                                                                                  |
| C3  | The booking submit is the only bypass of the shared HTTP path                 | `fetch($$$)`                                                                | **2** — `useJsonMutation.ts:42` (the hook), `NewAppointmentForm.tsx:98` (the bypass)                           | ✅ confirmed — and it refines `artifact-2-structure.md`, which called the hook _the_ single HTTP path                                                                                                                                             |
| C4  | `"23P01"` is the only runtime token joining the TS rule to the SQL constraint | `$E.code === "23P01"`                                                       | **2**, both in `services/appointments.ts` — `:207` (booking), `:334` (status change)                           | ✅ confirmed, and made precise: two sites, one file                                                                                                                                                                                               |
| C5  | `slot-suggestions.ts` has fan-out 0                                           | `import $$$ from $$$` scoped to that file                                   | **0**; `grep -c "^import"` → **0**                                                                             | ✅ confirmed (zero backstopped)                                                                                                                                                                                                                   |
| C6  | 12 API routes, each with exactly one uppercase handler export                 | `export const $M: APIRoute = $$$`                                           | **12** matches across **12** distinct files                                                                    | ✅ confirmed                                                                                                                                                                                                                                      |
| C7  | `AGENTS.md`: "API route input must be validated with zod"                     | `$S.safeParse($$$)`                                                         | **11** sites, of which 10 are in **9** route files (`appointment-status/[id].ts` has two)                      | ⚠️ **refined — the rule has three exceptions.** `api/auth/{signin,signout,signup}.ts` contain no `safeParse` at all; `signin.ts:5-7` reads `formData()` and casts `form.get("email") as string`, which is `null` when the field is absent **[E]** |
| C8  | The booking flow reaches Postgres through one RPC call                        | `$C.rpc($$$)`                                                               | **2** — `services/appointments.ts:197` (`book_appointment`), `services/workshop-setup.ts:53` (unrelated slice) | ✅ confirmed for this flow                                                                                                                                                                                                                        |

**What verification changed.** One claim was refined and one was made sharper. C7 turned a documented,
repo-wide rule into a rule with three unlisted exceptions — the same three auth routes that
`artifact-2-structure.md` already flagged for bypassing the service layer, so the deviation is
consistent and probably deliberate, but it is nowhere written down. C4 upgraded "one token" from a
reasoned claim to a counted one. Nothing in the report was refuted.

**Commands** (each pattern run for `--lang ts` and `--lang tsx`, results de-duplicated):

```bash
npx ast-grep run --pattern 'new Intl.DateTimeFormat($$$)' --lang ts  src --json=compact
npx ast-grep run --pattern 'fetch($$$)'                   --lang tsx src --json=compact
npx ast-grep run --pattern '$E.code === "23P01"'          --lang ts  src --json=compact
npx ast-grep run --pattern 'export const $M: APIRoute = $$$' --lang ts src --json=compact
npx ast-grep run --pattern '$S.safeParse($$$)'            --lang ts  src --json=compact
# every zero re-checked, .astro included:
grep -rn "\.getHours()" src --include="*.ts" --include="*.tsx" --include="*.astro"
```

---

## Method and limits

Three parallel sub-agents (trace / coverage / blast radius), each returning `file:line` and a claim
ledger; the load-bearing claims (the seam's commit history, the `fetch` call sites, the enforcement
table, the credential exposure) were re-verified in the main session. Every number here comes with the
command that produced it.

**Limits.** The repository is 3 months and 111 commits old — five of the ten booking-path files have ≤3
commits, so co-change counts below 3 are noise. No coverage tooling is configured, so there are no
percentages, only per-module verdicts. `dependency-cruiser` parses 59 of 73 source files; every fan-in
number is a **lower bound**. Nothing here was executed against a running database.
