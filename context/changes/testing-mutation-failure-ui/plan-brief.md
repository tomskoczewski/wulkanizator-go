# Mutation-failure UI tests (Risk #1) — Plan Brief

> Full plan: `context/changes/testing-mutation-failure-ui/plan.md`
> Research: `context/changes/testing-mutation-failure-ui/research.md`

## What & Why

`test-plan.md` §2 Risk #1: *"A worker taps a status, the tile updates, the write never landed — the day
plan shows a state the database does not have, and the workshop trusts it."* The rollback machinery to
prevent that exists on both status surfaces and is largely correct — but nothing asserts it, and S-04
shipped it knowing so, recording that *"a regression there would silently restore rollback-on-conflict."*
This is `test-plan.md` §3 Phase 3, and the pickup S-04 promised to Module 3.

## Starting Point

`DayPlanBoard.advance()` writes optimistically and delegates rollback to `useRowMutation`;
`AppointmentStatusPanel.changeStatus()` re-implements the same rule with panel-wide pending state. The
409-vs-revert decision is duplicated inline in both. Only the transport (`requestJson`) has a test. The
repo has **no DOM environment at all** — no `environment`, no `globals`, no testing library, zero
`.test.tsx` files — and Phase 1 left an empty folder, so there is no harness to inherit.

## Desired End State

`npm test` runs a mixed node + happy-dom suite in one invocation. For each surface, a forced failure at
the network edge provably reverts the tile and shows the worker a message; a `stale` 409 resyncs to the
server's truth while a `slot_taken` 409 reverts; and the pending state clears so a retry is possible.
`test-plan.md` §6.4 stops reading "TBD" and becomes the recipe for the next island test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope of surfaces | Both `DayPlanBoard` and `AppointmentStatusPanel` | They are two independently written state machines for one rule, so covering one says nothing about the other. | Research |
| DOM environment | `happy-dom`, opted in per file | `jsdom@30`'s Node floor (`^22.22.2`) sits above the pinned `.nvmrc` (`22.14.0`); happy-dom needs only `>=20.0.0`. | Plan |
| Global vitest config | Unchanged | Per-file `// @vitest-environment` keeps the existing node suite untouched and fast. | Plan |
| Duplicated 409 rule | Extract `resolveFailureStatus()`, test both | One tested oracle over the full taxonomy in node; DOM tests then only prove wiring. | Plan |
| Extraction semantics | Behaviour-preserving, unhardened | Keeps a test phase from smuggling in a behaviour change. | Plan |
| `@testing-library/jest-dom` | Not added | Plain Vitest `expect` covers every assertion; avoids a third dep and global type augmentation. | Plan |
| Failure injection | Network edge only (`vi.stubGlobal("fetch")`) | Matches the existing convention and §4's "never mock internal modules". | Research |
| §3 vanishing-row defect | Neither fixed nor tested | Keeps the phase purely additive — but leaves Risk #1's sharpest instance live. | Plan |
| Untriaged S-04 batch | Out of scope, recorded | The phase already carries a refactor and three new dependencies. | Plan |
| Non-vacuity | Required manual step per test phase | Precedent: S-04's impl-review F7 verified its service tests non-vacuous by mutation. | Plan |

## Scope

**In scope:** three test dependencies; the per-file happy-dom convention; `resolveFailureStatus()` plus
its taxonomy test; failure suites for both status surfaces covering revert+message, 409 discrimination,
and pending lifecycle; `test-plan.md` §6.4/§6.6/§4/§5/§3 updates; one `AGENTS.md` sentence.

**Out of scope:** the §3 vanishing-row defect (fix *and* test); filter-interaction and stat-counter
assertions; the untriaged re-entrancy guard and empty-`visible` dead state; settings rows and
`NewAppointmentForm`; any change to `vitest.config.ts`, `ci.yml`, or `.nvmrc`; route-level integration
tests (that is Phase 1's job).

## Architecture / Approach

One shared pure function becomes the oracle for *what status should show after a failure*, tested
exhaustively and cheaply in the existing node environment. Both components call it. The two DOM suites
then assert only the expensive part — that the component actually honours the decision on screen:
click → optimistic update → forced failure → visible revert → `role="status"` message → pending
cleared. Nothing between the component and `fetch` is mocked.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DOM test harness | Three deps, per-file env convention, a real `StatusPill` smoke test | `astro check` or the react-compiler lint rule rejecting `.test.tsx` |
| 2. Shared failure decision | `resolveFailureStatus()` + taxonomy test, both call sites rewired | An "extraction" that quietly changes behaviour |
| 3. DayPlanBoard failure tests | Revert+message, 409 discrimination, pending lifecycle | Label collision — every status label is also a filter button |
| 4. AppointmentStatusPanel failure tests | The same three on the panel's own state machine | `aria-busy` needs a deferred stub; `pendingTarget` clears before return |
| 5. Cookbook + bookkeeping | §6.4 filled, §3 corrected, `AGENTS.md` updated | Writing a recipe too vague for the next author to follow |

**Prerequisites:** none — no dependency on Phase 1 (API contract harness), which has not started.
**Estimated effort:** ~2–3 sessions across five phases; Phases 3 and 4 are the bulk.

## Open Risks & Assumptions

- The §3 vanishing-row defect stays live **and** uncovered — a known, reachable instance of Risk #1, and the first candidate for the next change here.
- Two S-04 items stay untriaged: no re-entrancy guard on `advance()`, and a blank board when a filter matches nothing.
- happy-dom is less battle-tested than jsdom; fallback is jsdom plus a `.nvmrc` bump.
- `resolveFailureStatus` casts `current` without validating it is a real enum member, exactly as today.
- Assumed (verified in Phase 1, not taken on faith): `astro check` type-checks `.test.tsx` files.

## Success Criteria (Summary)

- A forced write failure on either surface provably returns the tile to its true state **and** tells the worker — asserted against a real failure, never a mocked success.
- A `stale` 409 resyncs to the server's status while a `slot_taken` 409 reverts — the pair S-04 warned would silently regress.
- Breaking the rollback code turns the matching test red, proving the suite is not vacuous.
