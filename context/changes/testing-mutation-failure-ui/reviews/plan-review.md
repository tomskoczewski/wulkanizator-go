<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Mutation-failure UI tests (Risk #1)

- **Plan**: `context/changes/testing-mutation-failure-ui/plan.md`
- **Mode**: Deep (claims verified by direct grep, not sub-agent — files already in context from the research pass)
- **Date**: 2026-09-10
- **Verdict**: REVISE → **SOUND** after triage
- **Findings**: 0 critical, 4 warnings, 1 observation — all triaged

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING (F3, F5) | PASS |
| Architectural Fitness | WARNING (F1) | PASS |
| Blind Spots | WARNING (F2) | PASS |
| Plan Completeness | WARNING (F4) | PASS |

## Grounding

7/7 paths ✓, 2/2 new-file absences ✓, symbols ✓, brief↔plan ✓, Progress format ✓
(1 `## Progress`, 5/5 phases matched, 0 stray checkboxes). `docs/reference/contract-surfaces.md`
absent — surface check skipped. Progress contract re-verified after the F4 renumber: 6/5/5/5/5 ✓.

## Findings

### F1 — status-failure.ts inverts the services→components dependency edge

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 — `src/lib/services/status-failure.ts`
- **Detail**: The contract typed the parameter as `MutationFailure`, exported from
  `src/components/hooks/useJsonMutation.ts:3`. Verified `grep -rn 'from "@/components' src/lib/`
  returns nothing — no module under `src/lib/` imports from `src/components/` today, and the sibling
  `day-plan.ts:1` imports only from `@/types`. The plan would have created that first edge.
- **Fix A ⭐ Recommended**: Type the parameter structurally — `{ status?: number; body?: unknown }`
  - Strength: No import, no new edge; `MutationFailure` stays structurally assignable so both call sites pass their existing value unchanged.
  - Tradeoff: The shared shape becomes implicit rather than named in one place.
  - Confidence: HIGH — verified both fields exist and both call sites read only these two.
  - Blind spot: None significant.
- **Fix B**: Move `resolveFailureStatus` into `useJsonMutation.ts`
  - Strength: Sits beside the type it consumes; no new file or edge.
  - Tradeoff: Puts appointment-status domain logic in a generic mutation hook.
  - Confidence: MEDIUM — cleaner import graph, worse layering.
  - Blind spot: Whether other surfaces will later want the same helper.
- **Decision**: FIXED via Fix A

### F2 — The chosen status witnesses don't exist for terminal statuses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 3 §1; Phase 4 §1
- **Detail**: The plan made the advance button's accessible name the primary witness of a row's
  status, but the button renders only under `{target && …}` (`DayPlanBoard.tsx:241`) and `nextStatus`
  returns `null` for `done`/`no_show` — so a 409 resyncing to a terminal status has no witness. Same
  trap in Phase 4: `aria-current="step"` is set only inside `FORWARD_STEPS.map`
  (`AppointmentStatusPanel.tsx:71,83`), and `FORWARD_STEPS` excludes `no_show`. Both were named as the
  assertion mechanism with neither gap noted.
- **Fix A ⭐ Recommended**: Pin resync cases to a non-terminal `current` + document the gap
  - Strength: `current: "in_progress"` keeps both witnesses valid while exercising the same branch; one line in Critical Implementation Details stops the next author walking into it.
  - Tradeoff: Terminal-status resync stays untested at the DOM layer (still covered by Phase 2's node test).
  - Confidence: HIGH — verified both render conditions directly.
  - Blind spot: None significant.
- **Fix B**: Make the scoped `within(row)` pill query the primary witness everywhere
  - Strength: Works for every status including terminal ones.
  - Tradeoff: Layout-coupled traversal; the panel has no `StatusPill` at all.
  - Confidence: MEDIUM.
  - Blind spot: Phase 4 would still need a separate rule.
- **Decision**: FIXED via Fix A

### F3 — StatusPill smoke test asserts what the type system already enforces

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §2
- **Detail**: The plan justified keeping the test as "the cheapest possible regression guard on the
  label mapping", but `APPOINTMENT_STATUS_PRESENTATION` is `Record<AppointmentStatus, …>`
  (`src/lib/appointment-status.ts:14`) and its own doc comment says a new enum value "fails the build
  here". The test re-asserts a compile-time guarantee; its real value is one-time harness proof.
- **Fix**: Keep the test, drop the "permanent regression guard" justification from its Intent.
- **Decision**: FIXED

### F4 — "installs without an EBADENGINE warning" is not an automated check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Automated Verification 1.1
- **Detail**: Absence of a console warning has no exit code. `npm install` succeeds either way, so the
  bullet could never fail — false assurance on the one risk it existed to catch (the `.nvmrc` 22.14.0
  vs engine-floor question that drove the happy-dom choice).
- **Fix**: Move to Manual Verification and renumber Phase 1's Progress entries.
- **Decision**: FIXED

### F5 — Phase 5 edits another phase's bookkeeping

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 5 §3
- **Detail**: Correcting §3's Phase 1 row (`researched` → `not started`) is Phase 1's bookkeeping
  riding along in this change. The row is provably wrong — the folder is empty — and misleads the
  orchestrator's next-handoff derivation, but it is scope this change does not own.
- **Fix**: Keep it, or drop it and let `/10x-test-plan` re-derive the row from disk.
- **Decision**: KEPT AS PLANNED — the row is provably wrong and two cells is a cheap correction.

## Not counted as findings

The §3 vanishing-row defect staying uncovered, and the untriaged S-04 batch (missing re-entrancy
guard, empty-`visible` dead state). Both are explicit user decisions recorded in the plan's Open
Risks with rationale — reviewing them again would re-litigate settled scope.
