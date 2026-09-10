<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Mutation-failure UI tests (Risk #1)

- **Plan**: context/changes/testing-mutation-failure-ui/plan.md
- **Scope**: Phase 5 of 5 (full plan)
- **Date**: 2026-09-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

### Plan Adherence

All 10 tracked artifacts (package.json; StatusPill.test.tsx; status-failure.ts and its test;
DayPlanBoard.tsx and its test; AppointmentStatusPanel.tsx and its test; test-plan.md §3/§4/§5/§6;
AGENTS.md) match their plan contracts exactly. The only deviations are additive test cases beyond
the minimum contract (extra 409-discrimination edge cases in status-failure.test.ts,
DayPlanBoard.test.tsx, and AppointmentStatusPanel.test.tsx) — these strengthen coverage rather than
drift from intent.

### Scope Discipline

`git diff --name-only 6eceb57..4eda0ce` touches only the 16 files the plan's five phases account
for. Every "What We're NOT Doing" exclusion was honored: `vitest.config.ts`, `ci.yml`, `.nvmrc`
untouched; no `@testing-library/jest-dom` added; `NewAppointmentForm.tsx` and settings-island files
untouched; the §3 vanishing-row defect stays unfixed and unclaimed; no re-entrancy guard added to
`advance()`; no enum validation added to `resolveFailureStatus`'s `current` cast.

### Safety & Quality

The Phase 2 refactor's behaviour-preservation claim was verified precisely against the pre/post diff
on both call sites:
- `DayPlanBoard.tsx`'s `onFailure` (old inline 409-check → `resolveFailureStatus(from, failure)`):
  `resynced` maps 1:1 onto the old boolean; `rollback` is untouched.
- `AppointmentStatusPanel.tsx`'s `changeStatus` (old ternary → `resolveFailureStatus(...).status`):
  reduces to the identical ternary.

No security, performance, or data-safety findings — `status-failure.ts` is pure and synchronous, no
auth surface touched, no migrations in this diff.

### Architecture

`status-failure.ts` is structurally typed against `{status?, body?}` rather than importing
`MutationFailure` from `src/components/hooks/`, preserving the repo's `src/lib/` → never imports from
`src/components/` invariant (grepped and confirmed). Placed in `src/lib/services/` per the
extracted-business-logic convention.

### Pattern Consistency

`status-failure.ts` mirrors sibling services' docblock/interface/named-export shape.
`status-failure.test.ts` mirrors `day-plan.test.ts`'s describe/it structure.
`DayPlanBoard.test.tsx`'s `entry()` fixture is field-for-field identical to the established
`day-plan.test.ts` builder. All three new `*.test.tsx` files share the same
`// @vitest-environment happy-dom` docblock placement and `afterEach(cleanup)` + `vi.unstubAllGlobals()`
convention.

### Success Criteria

- `npm test`: 10 files, 91 tests passed.
- `npm run lint`: 0 errors (11 pre-existing `no-console` warnings, unrelated to this change).
- `npm run typecheck`: 0 errors.
- All Manual verification items across all 5 phases are `[x]` in the plan's Progress section, each
  with a commit SHA.
- Network-edge-only mocking confirmed: `grep` for `vi.mock`/`jest.mock` across all four new test
  files returns zero hits; all failure injection goes through `vi.stubGlobal("fetch", ...)`.
- No vacuous assertions: every DOM test pins both the visible message and the resulting status via
  an unambiguous witness, and the plan's own Progress log records non-vacuity checks were run
  (breaking `rollback`/`onFailure`/`setStatus` and confirming the matching test goes red) before each
  phase closed.

## Findings

None.
