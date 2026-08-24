<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Worker Status Changes (S-04)

- **Plan**: `context/changes/worker-status-changes/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → SOUND after triage (all 6 findings fixed in the plan)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS after F1 fix |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS after F2, F4 fixes |
| Plan Completeness | WARNING → PASS after F3, F5, F6 fixes |

## Grounding

12/12 paths ✓, 9/9 symbols ✓, brief↔plan ✓. Database claims verified directly: partial exclusion constraint (`20260821090000_appointments_and_customers.sql:56-61`), column-narrowed grant (`20260821151500_appointments_update_status_only.sql:11`), both-role UPDATE policy (`:96-101`), `plan(48)` at `rls_workshop_scope.test.sql:11` — all accurate as the plan states. Progress↔Phase structure conformant.

## Findings

### F1 — 409 "resync to current" can't travel through useRowMutation

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment (promise gap)
- **Location**: Phase 2 §2, Phase 3 §1 contract note, Phase 4 §1, Desired End State
- **Detail**: The plan promised in five places that a 409 carrying `current` resyncs the row instead of rolling back, but `requestJson` collapses every failure to `{ fieldErrors, message }` (`useJsonMutation.ts:47-56`), discarding the status and any extra body field, and `useRowMutation.run` returns `boolean` after calling `rollback()` unconditionally (`:122-129`). `NewAppointmentForm.tsx:88-89` hand-rolled its own `fetch` for exactly this reason. No phase extended the hook, so a literal implementation of Phase 4 would ship rollback-on-409 — the behavior the Desired End State rules out.
- **Fix A ⭐ Recommended**: Extend the transport additively in Phase 1 — `status`/`body` on `MutationFailure`, optional `onFailure` on `useRowMutation`'s handlers.
  - Strength: Purely additive; the four existing callers keep compiling, and Phase 4 keeps the keyed pending state criterion 4.9 needs.
  - Tradeoff: Touches a hook shared by 4 components.
  - Confidence: HIGH — verified all four call sites destructure only the fields they use.
  - Blind spot: Whether `NewAppointmentForm` should fold back onto the shared helper (out of scope).
- **Fix B**: Hand-roll fetch in both new components, per the `NewAppointmentForm` precedent.
  - Strength: Zero blast radius; follows an existing documented pattern.
  - Tradeoff: The day plan loses `useRowMutation`'s keyed pending/error state that Phase 4 requires.
  - Confidence: MEDIUM — works, but reintroduces the shared-`isPending` bug the hook's docstring warns against.
  - Blind spot: Makes hand-rolled conflict fetches the de-facto standard.
- **Decision**: FIXED via Fix A — Phase 1 gained §4 (`useJsonMutation.ts`); Key Discoveries corrected; Phase 3 and Phase 4 contract notes now name the mechanism. Follow-up on request: Phase 1 §5 adds `useJsonMutation.test.ts` pinning that `requestJson` surfaces a 409's `status` and `body` while leaving the existing failure paths unchanged, plus criterion 1.2 asserting both new suites actually run. `useRowMutation`'s `onFailure` branch is deliberately left manual-only (criteria 3.7, 4.9) — unit-testing a `useCallback`-bound function would require adding `@testing-library/react` and a `jsdom` environment the repo does not have, which the plan scopes to Module 3. That residual gap is recorded in the brief's Open Risks.

### F2 — Optimistic advance under an active filter makes the row vanish

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: The board renders `filterByStatus(entries, filter)` (`DayPlanBoard.tsx:57`) and ships four status filter pills (`:118-132`). With "Oczekuje" selected — the natural worker filter — a one-tap advance drops the row out of `visible` at the moment of the tap. On failure the inline per-row error renders on a card that is no longer mounted, so a failed advance under a filter gives no feedback at all. Manual criteria 4.6–4.11 never exercised a filter.
- **Fix A ⭐ Recommended**: Pin just-mutated rows — `recentlyChanged: ReadonlySet<string>` in board state; `visible` = filter-matched ∪ pinned; clear on filter change or day navigation.
  - Strength: The row stays put through the whole tap→confirm→error cycle; pure `day-plan.ts` functions untouched.
  - Tradeoff: A pinned row briefly contradicts the active filter label.
  - Confidence: HIGH — `filterByStatus` is a pure filter over local state; the union happens at the render site only.
  - Blind spot: Tile counts are unaffected (they count `entries`, not `visible`).
- **Fix B**: Render mutation errors at board level, above the list.
  - Strength: Simplest edit; the error is always visible.
  - Tradeoff: Drops per-row placement and can't disambiguate two simultaneous failures.
  - Confidence: MEDIUM — fixes the invisible-error half only.
  - Blind spot: Whether a vanishing card is acceptable is a product call.
- **Decision**: FIXED via Fix A — Phase 4 §1 gained a "Contract note on the status filter"; new manual criterion 4.11 (Progress renumbered to 4.12).

### F3 — Phase 4's doc sync adds one API route to a pages-only table, and its grep gate is a no-op

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2, criterion 4.5
- **Detail**: README's "Auth routes" table (`README.md:145-153`) documents user-facing pages only; none of the five `/api/*` prefixes already in `ROUTE_ACCESS` appear there, so adding only the sixth would be worse drift than adding none. Separately, criterion 4.5's `grep -rn "api/appointments" README.md AGENTS.md CLAUDE.md` returns **zero hits today** — verified — so the gate passed unconditionally and verified nothing, and its "returns only accurate statements" wording isn't automatable anyway.
- **Fix**: Drop the README table edit (`README.md:155` already names `auth-guard.ts` as the source of truth), move the doc question to "What We're NOT Doing", and replace 4.5 with `grep -n "api/appointment-status" src/lib/auth-guard.ts src/lib/auth-guard.test.ts` hitting both files.
- **Decision**: FIXED — Phase 4 §2 (README) removed and renumbered; new "What We're NOT Doing" bullet; criterion 4.5 and Progress 4.5 replaced.

### F4 — `toDayPlanEntry` can return null after the write has committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1
- **Detail**: `StatusChangeOutcome`'s success branch required a non-null `DayPlanEntry`, but `toDayPlanEntry` returns `DayPlanEntry | null` — it drops a row with a missing join and logs (`appointments.ts:228-232`). The UPDATE has already committed at that point, so throwing (→ 500) would roll the client's optimistic change back while the database holds the new status, leaving UI and row silently disagreeing.
- **Fix**: Widen the success branch to `{ status: "updated"; current: AppointmentStatus; entry: DayPlanEntry | null }` and answer `200` with `{ id, status }` alone in the null case, letting `toDayPlanEntry`'s existing `console.warn` carry the diagnostic.
- **Decision**: FIXED — outcome union and Phase 2 §1/§2 contracts updated.

### F5 — Two implementer-facing decisions left open

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2, Critical Implementation Details
- **Detail**: Phase 3 left the server-rendered `StatusPill` at `wizyty/[id].astro:40` as "move it into the island's ownership, or drop it from the header" — a visible UX choice, and the one the brief named as Phase 3's key risk. (The nested-link fix is likewise left open, but those two options are genuinely equivalent, so that one stands.)
- **Fix**: Drop the pill from the detail header — the step grid shows current state more richly, and removing it keeps status ownership inside the island rather than straddling the Astro/React boundary.
- **Decision**: FIXED — Phase 3 §2 now states the drop as the contract and notes `StatusPill` itself stays for `DayPlanBoard.tsx:162`.

### F6 — The "row invisible" stale branch is unreachable and self-contradicting

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: Returning "`stale` with the client's `from`" tells the client its stale belief is the true current status while also signalling a conflict, so the panel would resync to the wrong value and show a self-contradicting message. It's also unreachable: `20260821090000` grants no DELETE on `appointments` ("No DELETE grant or policy on either table") and RLS scoping doesn't shift mid-session.
- **Fix**: Return a `not_found` outcome → `404`, matching `getAppointmentDetail`'s "never leaks existence" posture (`appointments.ts:286-287`) and the 404 the route already gives an unknown id.
- **Decision**: FIXED — `not_found` added to the outcome union; Phase 2 §1 rewritten with the rationale.

## Triage Summary

- **Fixed**: F1 (Fix A), F2 (Fix A), F3, F4, F5, F6 — 6
- **Skipped / Accepted / Dismissed**: none

Plan and brief both updated. Verdict after fixes: **SOUND**.
