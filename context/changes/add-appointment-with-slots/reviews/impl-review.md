<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add Appointment with Free-Slot Suggestions (S-02)

- **Plan**: context/changes/add-appointment-with-slots/plan.md
- **Scope**: Phase 5 of 5 (full plan)
- **Date**: 2026-08-21
- **Verdict**: REJECTED
- **Findings**: 1 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `book_appointment()` never checks that the bay/service belong to the caller's own workshop

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260821090000_appointments_and_customers.sql:114-152
- **Detail**: `book_appointment()` is `SECURITY DEFINER`, callable directly via PostgREST RPC by any `authenticated` user (not only through the Astro API route). It correctly stamps `workshop_id` on both inserts from `current_workshop_id()`, but `p_bay_id` and `p_service_id` are only checked for *existence* via their FK constraints (`references public.bays(id)`, `references public.services(id)`) — never for belonging to that workshop. An owner of workshop A can call the RPC directly with workshop B's `bay_id`, inserting a row with `workshop_id = A` but `bay_id` belonging to B. Since the exclusion constraint (`appointments_no_overlap_per_bay`) scopes only by `bay_id` (not `workshop_id`), this row occupies/blocks a real slot on B's bay — B's owner sees their bay behave as busy with no visible cause (RLS hides A's row from B's `SELECT`s). This is exactly the class of cross-tenant break F-01's RLS foundation exists to prevent, reached through a path the app's own preflight (`suggestSlotsForService`, RLS-scoped to the caller's own bays) only coincidentally blocks in the normal UI flow — it provides no DB-level guarantee. `rls_workshop_scope.test.sql` has no test covering this path.
- **Fix**: Add explicit ownership checks for `p_bay_id` and `p_service_id` against `v_workshop_id` inside the function body, before either insert, then ship as a new migration (`create or replace function` — same signature, so no drop/recreate needed) and re-push to production.
  - Strength: Closes the gap at the source (the function itself), matching the "SECURITY DEFINER re-implements the guard itself" intent already stated in the migration's own header comment — it just missed two of the three things that needed guarding (role + workshop existence were checked; resource ownership wasn't).
  - Tradeoff: Requires a new production migration and a fresh `db push`/deploy cycle, since the vulnerable version is already live.
  - Confidence: HIGH — the fix is a straightforward `if not exists (select 1 from public.bays where id = p_bay_id and workshop_id = v_workshop_id) then raise exception ...` pair, matching patterns already used elsewhere in the function.
  - Blind spot: Haven't checked whether any other `SECURITY DEFINER` function in the codebase has the same class of gap (only this migration was in scope for this review).
- **Decision**: FIXED — commit `ecad10c`, migration pushed to production and code pushed to `origin/main`

### F2 — `appointments` UPDATE policy grants full-row write, not status-only, to both roles

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260821090000_appointments_and_customers.sql:71-72, 96-101
- **Detail**: The plan's own Phase 1 contract states the intent explicitly: "S-04's whole point is that a worker changes status" — but the grant (`grant select, insert, update on public.appointments to authenticated`) and the `appointments_update_own_workshop` policy are table-wide, not column-restricted. A worker (or owner) calling PostgREST directly can rewrite `bay_id`, `starts_at`, `ends_at`, `service_id`, or `customer_id` on any appointment in their own workshop, bypassing the slot-suggestion/working-hours validation entirely. The exclusion constraint still blocks a literal double-booking, but nothing stops a move to a time outside working hours or onto a since-deactivated bay. This was a deliberate plan decision (not an implementation slip), so it's flagged here as a plan-level design note per the review's mandate to catch plan issues too, not as a coding error.
- **Fix A ⭐ Recommended**: Narrow the grant to `grant update (status) on public.appointments to authenticated` now, matching the comment's actual stated intent, and revoke the broader `update`.
  - Strength: Closes the risk immediately at zero cost to S-02's own functionality (S-02 never updates existing rows) and matches what the code's own comment already claims is true.
  - Tradeoff: S-04 will need to explicitly widen the grant (or add specific columns) when it implements richer status-change behavior — a small, foreseeable follow-up cost.
  - Confidence: MED — column-level grants are supported by Postgres/PostgREST, but no other table in this codebase uses one yet, so there's no existing pattern to copy verbatim.
  - Blind spot: Haven't checked whether S-04's plan (not yet written) already assumes full-row UPDATE access.
- **Fix B**: Accept as-is — this is what the plan explicitly asked for — and record the residual risk (worker/owner can move an appointment outside validated hours via direct API access) as a lesson or a note for S-04 to inherit.
  - Strength: Zero implementation risk right now; exactly matches the plan's literal intent.
  - Tradeoff: Leaves a wider-than-strictly-necessary write surface live in production for the entire S-02→S-04 gap.
  - Confidence: HIGH that this matches the plan's literal words.
  - Blind spot: None significant.
- **Decision**: FIXED — Fix A applied

### F3 — `NewAppointmentForm.tsx`'s booking submit bypasses the `useJsonMutation` pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/appointments/NewAppointmentForm.tsx:97-137
- **Detail**: The plan's Phase 4 Intent names `useJsonMutation` explicitly ("so a network rejection can never escape as an unhandled promise"), and the slots-fetch call in the same component (line 92) does use it. The booking `handleSubmit`, however, hand-rolls `fetch()` + manual JSON parsing + status branching. This is a deliberate, justified deviation — `useJsonMutation`'s `MutationResult` shape only carries `ok`/`fieldErrors`/`message` on failure, with no room for the 409 response's `slots`/`emptyReason` payload the booking flow needs to swap in fresh chips — and the raw version still satisfies the underlying guarantee (try/catch, no unhandled rejection). It just isn't visually obvious from the code that this is intentional rather than an oversight.
- **Fix**: Add a one-line comment above `handleSubmit` noting why `useJsonMutation` isn't used here (needs the 409 body's `slots`/`emptyReason`, which the hook's generic result shape can't carry).
- **Decision**: PENDING

### F4 — `STARTS_AT_PATTERN` validates digit shape, not value ranges

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas/appointment.ts:6
- **Detail**: `/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/` accepts a value like `2026-01-01T99:99`; `timestampStringToNaiveDate` → `Date.UTC(...)` silently normalizes it into a different (wrong) date rather than rejecting it. In practice this is caught downstream — an out-of-range time will essentially never match a real offered slot in `bookAppointment()`'s `stillOffered` check, so it degrades to a 409 rather than corrupting data — but the schema doesn't do the range-validation job its name implies, unlike the existing `TIME_HH_MM` precedent in `workshop-setup.ts`.
- **Fix**: Constrain hour/minute/second ranges in the regex, e.g. `^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$`, matching `TIME_HH_MM`'s existing convention.
- **Decision**: PENDING

### F5 — Redundant `services` round-trip in `bookAppointment()`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/appointments.ts:176, 185-189
- **Detail**: The preflight call (`suggestSlotsForService`) already fetches `duration_min` from `services`. `bookAppointment()` re-queries `services` again immediately after for the same value — not a correctness issue, just an avoidable extra round trip on every booking.
- **Fix**: Thread the `durationMin` already fetched during preflight through to the insert path instead of re-querying.
- **Decision**: PENDING

### F6 — `suggestSlots()`'s per-bay loop isn't limit-bounded within a single day

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/slot-suggestions.ts:54-84
- **Detail**: `results.length >= limit` is only checked between day-window iterations (line 55); within one day, every bay's `while` loop runs to completion before `dayResults` is trimmed by the final `.slice(0, limit)`. Fine at current scale (1-5 bays, 14-day horizon) — flagged only because it would scale linearly with bay count × window/step rather than stopping early once a day already has enough candidates.
- **Fix**: Not urgent at current scale; revisit only if bay count grows materially.
- **Decision**: PENDING

### F7 — Production-only manual checks (5.5–5.7) have no observable artifact in this session

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (process note)
- **Detail**: Every other manual Progress item in this plan (3.5-3.12, 4.5-4.10) was directly witnessed in this session via curl or live browser automation. Items 5.5 (production RLS/extension/constraint check), 5.6 (hand-run `23P01` test), and 5.7 (real production booking) were confirmed by the user, but the implementer had no production database credentials and so has no screenshot or query output on record for these three — unlike the rest of the checklist.
- **Fix**: None required; noted per the review's rubber-stamp-detection guidance. Re-verify only if there's reason to doubt the confirmation.
- **Decision**: PENDING
