<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Dedupe customers by phone inside `book_appointment()`

- **Plan**: `context/changes/customer-dedupe-on-booking/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-25
- **Verdict**: REVISE → SOUND (all 7 findings fixed in the plan during triage)
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

8/8 paths ✓, 9/9 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md` absent — surface check skipped per skill.

**Live probe.** The plan's core mechanics were executed against the local Supabase Postgres in two throwaway schemas (dropped afterwards), rather than reasoned about:

- `on conflict (workshop_id, phone_normalized) where (length(phone_normalized) >= 9) do nothing … returning id into v_customer_id` **infers the partial unique index correctly** against a *stored generated* column, and leaves `v_customer_id` null on conflict so the fallback branch runs. The plan's central assumption holds.
- Cross-workshop isolation holds; below-threshold phones (`-`, `brak`) each keep their own row; a direct duplicate insert raises `23505`.
- The Phase 1 ordering (function → generated column → merge → index) applies cleanly over a table that already holds duplicates, and the merge leaves zero dangling `appointments.customer_id`.

Two facts the probe surfaced that the plan had wrong or unstated are F1 and F2 below.

## Findings

### F1 — Phase 3's test phone already exists in the fixture it books against

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — assertions 1–4
- **Detail**: Phase 3 assertion 1 booked `600 100 100` as owner A, but the suite already books `'600100100'` as owner A at `supabase/tests/rls_workshop_scope.test.sql:338` ("Jan"), and the whole file runs inside one `begin; … rollback;` (`:9`, tail) so that row is live when the new block runs. Normalized they are identical: assertion 1 ("count rises by exactly 1") would see `+0` and fail, and assertion 4 ("surviving `first_name` is from the first booking") would be pinned to `Jan` from `:338` rather than the new block's first booking. The plan warned about slot-date collisions with existing fixtures (Phase 3 Note) but not phone collisions — the identical class of trap, one level over.
- **Fix**: Switch the Phase 3 block to `601 200 300` / `+48601200300` (every existing literal is `6001…`–`6008…`), and expand the Phase 3 Note into two named collision classes — slot dates *and* post-normalization phone collisions — with a `grep` instruction for the latter.
- **Decision**: FIXED

### F2 — Normalization misses two common Polish formats, behind a one-way door

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §1 Contract (`normalize_phone`) / Desired End State
- **Detail**: Desired End State promises dedupe "in any common formatting". Measured on the local Postgres, the originally specified rule (strip non-digits, drop a `48` prefix only at exactly 11 digits) gave `600 100 100` → `600100100` ✓ and `+48 600 100 100` → `600100100` ✓, but `0048600100100` → `0048600100100` ✗ and `0 600 100 100` → `0600100100` ✗. Both failures are ≥ 9 digits, so they enter the partial unique index as *separate* customers — silently, with no error. This matters more than an ordinary miss because the plan itself names the one-way door: a stored generated column never recomputes, so widening the rule later costs a backfill migration **and** a second irreversible merge on live data.
- **Fix A ⭐ Recommended**: Widen the rule now — peel a leading `00` (when > 11 digits remain), then `48` (at exactly 11), then a domestic trunk `0` (at exactly 10).
  - Strength: Verified on this Postgres across 11 format variants; collapses all of `600100100`, `600 100 100`, `600-100-100`, `+48 600 100 100`, `48600100100`, `0048600100100`, `00 48 600 100 100`, `0 600 100 100`, `0600100100` to one key, while leaving `-`, `brak` and long junk untouched.
  - Tradeoff: More logic to comment; the trunk-`0` rule is another Poland-specific assumption to name.
  - Confidence: HIGH — executed against the live local database.
  - Blind spot: The wider rule merges strictly *more* production rows on first run, so the Phase 5.1 audit must be run with the final expression.
- **Fix B**: Ship the narrow rule and record the gap as accepted.
  - Strength: Smaller surface; the dominant walk-in format is already covered.
  - Tradeoff: Correcting it later is the plan's own stated one-way door.
  - Confidence: MEDIUM — no data on how often owners type `0`/`0048` forms.
  - Blind spot: Real production phone formats were never sampled.
- **Decision**: FIXED via Fix A (plan and brief both updated; the verified SQL body is now inline in Phase 1)

### F3 — The one irreversible statement is the only one left as prose

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 Contract, merge bullet
- **Detail**: Phase 2 — fully reversible via `create or replace` — got literal SQL. The merge, which deletes production rows with no undo (Migration Notes), got one prose sentence. The implementer had to derive two statements whose keeper subquery must be byte-identical; if they diverge, the UPDATE repoints appointments at a row the DELETE then removes and `on delete restrict` aborts the migration after the column rewrite has already run.
- **Fix**: Write both statements into the plan as a shared `keepers` CTE (`distinct on (workshop_id, phone_normalized) … order by workshop_id, phone_normalized, created_at, id`), with an explicit "do not let the two drift" comment. The shape was executed against a fixture holding a 3-row duplicate group, a singleton, two below-threshold rows and a same-phone customer in a second workshop; it left exactly the right five survivors, repointed all seven appointments, and reported zero dangling `customer_id`.
- **Decision**: FIXED

### F4 — No contingency if `db push` applies migration 1 and fails on 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §2 step 6
- **Detail**: The plan claims the ship sequence "exists partly to guarantee production never sees that window" — index present, RPC still inserting unconditionally, `23505` rethrown as a 500 by `bookAppointment()` (`src/lib/services/appointments.ts:205-211`, which only special-cases `23P01`). But step 6 is one `npx supabase db push` across two files and the CLI applies each migration in its own transaction. If `20260825120000` commits and `20260825120100` fails, production sits in exactly that window, with the irreversible merge already committed and no undo. The sequence had no step for it.
- **Fix**: Insert a new step 7 that checks `prosrc like '%on conflict%'` on the production `book_appointment`, and — if false — instructs pasting the Phase 2 migration body into the SQL editor **immediately**, before investigating (it is idempotent and grant-preserving). Renumber the rest; the load-bearing pair becomes steps 6 and 9.
- **Decision**: FIXED (Success Criteria and `## Progress` renumbered to match — Phase 5 now runs 5.1–5.8)

### F5 — `plan(61)` undercounts the assertions the described block needs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: `54 + 7 = 61` assumed the 7 listed items were the only assertions. The file wraps every booking in `lives_ok` (`:337`, `:361`, `:501`, `:578`), and the block needs ~5 bookings (two formats as owner A, one as owner B, `-` twice) before the 7 checks can run — a real total nearer 12. Criterion 3.1's planned-vs-ran check catches it on first run, but the plan's stated number was wrong.
- **Fix**: Replace the fixed number with the rule for deriving it — count the actual `ok/is/lives_ok/throws_ok` calls in the finished block; criterion 3.1 is the confirmation, not the source.
- **Decision**: FIXED

### F6 — The Phase 5.1 audit re-states the normalization rule by hand

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 5 §1
- **Detail**: The audit "inlin[ed] the normalization expression (the function does not exist there yet)" — a second copy of the rule that can drift from the migration's. The post-merge verification step checks its counts against that prediction, so a mismatch is ambiguous between "the merge misbehaved" and "the audit's expression differed". F2's widening makes the expression longer and the drift risk correspondingly larger.
- **Fix**: Run the audit as `begin; <create function pasted verbatim from the migration>; <audit selects using public.normalize_phone(phone)>; rollback;` — one definition, and the step stays genuinely read-only.
- **Decision**: FIXED

### F7 — Phase 4 edits an explicitly append-only file without naming it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1
- **Detail**: `context/foundation/lessons.md:3` declares itself an "Append-only register". Phase 4.1 retitles the entry and rewrites its Problem clause in place. The dated `Corrected 2026-08-25` line is a sound reconciliation, but the plan never acknowledged the convention it bends, so an implementer following the file's own header may balk or quietly do something else.
- **Fix**: Name the convention in Phase 4.1's Intent and state that the dated correction line is what honours it — the false clause is retracted on the record, never silently deleted.
- **Decision**: FIXED

## Notes for implementation

- The plan's central technical bet was verified empirically, not argued: `ON CONFLICT` inference against a partial unique index on a stored generated column works, and the `returning … into` / null-check / fallback-select shape behaves as written.
- Nothing was found wrong with the approach itself. All seven findings were coverage and specification gaps, and all seven are now closed in `plan.md`.
- Two standing risks remain **accepted, not fixed**, and are already recorded in the plan: `npm run db:test` is local-only (absent from `.husky/pre-push` and `ci.yml`), and the merge has no undo beyond a Supabase restore.
