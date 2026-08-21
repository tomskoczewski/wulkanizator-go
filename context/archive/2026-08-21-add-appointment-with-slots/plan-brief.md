# Add Appointment with Free-Slot Suggestions (S-02) — Plan Brief

> Full plan: `context/changes/add-appointment-with-slots/plan.md`
> Research: `context/changes/add-appointment-with-slots/research.md`

## What & Why

Roadmap slice S-02, the middle link in the north-star chain `S-01 → S-02 → S-03`. The owner picks a
service, types a walk-in customer's first name and phone, gets the nearest free slots computed from
service duration, bay occupancy and working hours, and books one in a single tap. This is the
product's domain core: the PRD calls two appointments on one bay at one time "a regression worse than
paper" (`prd.md:41`), so the correctness guarantee goes in Postgres, not in application code.

## Starting Point

S-01 is done and archived. `bays`, `services` and `working_hours` exist under the F-01 workshop-scoped
RLS pattern, and every workshop is seeded with six services, one bay and seven weekday rows — so the
algorithm never meets an unconfigured workshop. Missing entirely: any customer table, any appointment
table, any time-of-day model (`src/` has no `Intl` usage, no timezone string, no date library), and
any JavaScript test runner (pgTAP only).

## Desired End State

An owner at `/wizyty/nowa` books an appointment in a few taps; it lands with `status = 'waiting'` on a
system-assigned bay, and that slot is provably unbookable a second time — concurrent inserts leave
exactly one row, rejected by an exclusion constraint. S-03 then has real data to render.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Build vs buy | Hand-written ~80-line algorithm, zero deps | No candidate library clears the stack's quality gates, and each models a single resource while we schedule across 1–5 bays | Research |
| Overlap guarantee | Postgres `EXCLUDE USING gist` over `tsrange`, partial on live statuses | A check-then-insert in the route loses to two simultaneous requests; only the DB closes the window | Research |
| Time model | Naive local `timestamp` (not `timestamptz`) | Deletes the hard local→instant conversion entirely, leaving only instant→local-parts, which `Intl` does natively with no dependency | Plan |
| `@date-fns/tz` | Not adopted | It exists to solve the conversion the naive model removes; Poland's DST switch is at 02:00 Sunday, outside every working window anyway | Plan |
| Customer storage | Minimal `customers` table now | S-05 then extends additively instead of migrating appointments out of denormalized strings | Plan |
| Bay assignment | System assigns, hidden from the UI | Matches the brochure's `AddVisitScreen` (time chips, no bay control) and the "kilkanaście sekund" promise | Plan |
| Bay eligibility | Every active bay does every service | Resolves the one research question flagged as blocking; a mapping table has no PRD requirement behind it | Plan |
| Slot grid | 15-minute | Produces the round times the brochure shows; a 30-min grid wastes 25 min on the two 20-min seeded services | Plan |
| Suggestions | Nearest 6, spilling into the next open day | Research suggested 10; 6 fills two chip rows at 360px, and the spill means a full day never returns nothing | Plan |
| "Add now" escape hatch | Cut | One code path, one invariant; the nearest suggestion is already "now" when a bay is free | Plan |
| Status enum | All five values now, only `waiting` written | The colours are already locked in `design-system.md` and S-04 owns transitions — avoids a later `alter type` | Plan |
| Race handling | 409 carrying freshly-recomputed slots | The owner recovers in one tap without retyping the customer | Plan |
| Testing | Add Vitest for the algorithm, extend pgTAP for RLS + the constraint | The slot function is the hardest guardrail and is untestable at speed any other way | Plan |

## Scope

**In scope:** `customers` + `appointments` schema with `btree_gist` exclusion constraint and RLS;
five-value status enum; pure `suggestSlots()` plus an `Intl`-based workshop-clock helper; Vitest
toolchain and the algorithm's edge-matrix tests; pgTAP additions; suggestion + booking API routes with
`23P01` → 409 translation; the `/wizyty/nowa` screen replicating the brochure; docs and ship sequence.

**Out of scope:** day-plan rendering (S-03); status changes and transitions (S-04); customer
directory, search and cars (S-05); tire storage and the "Opony" block (S-06); the "Notatka" field
(FR-008); editing or cancelling appointments; manual slot/bay override (Parked); any date picker; any
new runtime dependency.

## Architecture / Approach

Defence in depth, three layers with distinct jobs: **zod** rejects malformed input at the API
boundary, the **algorithm** avoids proposing a conflict, the **exclusion constraint** guarantees one
cannot be stored. The first two are UX; the third is correctness.

```
/wizyty/nowa (Astro)  →  NewAppointmentForm (React island)
        │                        │  POST /api/appointments/slots
        │                        │  POST /api/appointments        → 409 + fresh slots on race
        ▼                        ▼
   auth-guard (owner-only)   appointments service ── suggestSlots() ← pure, unit-tested
                                     │                    ▲
                                     ▼                    │ workshop-clock.ts (Intl, the only
                              Supabase / RLS              │  module that touches timezones)
                                     ▼
                    appointments · EXCLUDE USING gist (bay_id =, tsrange &&)
```

Times are naive workshop wall-clock end to end: `timestamp` columns, `tsrange` in the constraint,
`Date` objects read as local. Half-open `[start, end)` intervals must hold in all three layers — the
likeliest off-by-one hides at exactly the back-to-back boundary, the commonest case in a tire shop.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, RLS & overlap guard | Both tables, enum, `btree_gist`, exclusion constraint, pgTAP proof | Getting the `'[)'` bound or the partial `where` wrong silently breaks back-to-back booking or `no_show` slot release |
| 2. Slot algorithm & Vitest | Pure `suggestSlots()`, workshop-clock helper, first JS test suite | Weekday derived from UTC instead of workshop-local reads the wrong `working_hours` row near midnight |
| 3. Service, schemas & API | Suggestion + booking endpoints, guard entries, 409 translation | Trusting client-sent `ends_at`, or leaking the constraint `DETAIL` (which is produced before RLS filtering) |
| 4. "Nowa wizyta" screen | The brochure-faithful booking form | Drifting from `AddVisitScreen` instead of replicating it near-1:1 |
| 5. Ship | Docs, roadmap sync, migration-before-merge | Merging ahead of `supabase db push` — the failure `lessons.md:5` already records from F-01 |

**Prerequisites:** S-01 done (satisfied); local Supabase stack running; the brochure repo cloned
(already at `~/Code/wulkanizator-go-brochure`); production Supabase access for the Phase 5 push.

**Estimated effort:** ~3–4 sessions across 5 phases. Phases 1 and 2 carry most of the thinking; 3 and
4 are largely pattern-following against existing code.

## Open Risks & Assumptions

- **Assumption: every active bay can perform every service.** If a workshop has a truck-only bay, the
  system will route a passenger car there. Recoverable later — adding a filter migrates no data.
- **Both inserts (customer, then appointment) go through one `security definer` `book_appointment()`
  RPC** — supabase-js has no client-side transaction, and two separate inserts would orphan a
  customer row on every lost race, which the 409-retry loop makes routine. One function call is one
  implicit transaction. The cost: the function must re-implement the owner/workshop guard in its own
  body, since `security definer` bypasses RLS — pgTAP proves it.
- **The naive-`timestamp` choice is a one-way door for multi-timezone.** Explicitly fine: PRD
  Non-Goals cap the product at one workshop per account.
- **Vitest is new toolchain cost inside a 3-week after-hours budget** — accepted deliberately, because
  the slot algorithm's edge matrix is not reachable by manual testing.
- **Success is verified through the database and the form's own confirmation**, since no day plan
  exists yet to see the appointment on.

## Success Criteria (Summary)

- The owner books an appointment end-to-end in a few taps, and the chosen slot stops being offered.
- Two people booking the same slot at the same instant produce exactly one appointment; the loser sees
  fresh slots and keeps their typed customer data.
- A closed day, a nearly-closed day, and a fully-booked day all behave sensibly — empty or rolled
  forward, never a wrong slot and never an error.
