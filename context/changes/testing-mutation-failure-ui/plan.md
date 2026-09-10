# Mutation-failure UI tests (Risk #1) Implementation Plan

## Overview

Close the general failure branch of `test-plan.md` §2 Risk #1 — *"a worker taps a status, the tile
updates, the write never landed"* — by introducing the repo's first DOM test environment, extracting
the duplicated 409-vs-revert decision into one tested function, and proving on **both** status
surfaces that a failed write visibly reverts and tells the user.

This is `test-plan.md` §3 **Phase 3 (Mutation-failure UI)**.

## Current State Analysis

The rollback machinery exists and is largely correct; nothing asserts it.

- `DayPlanBoard.advance()` (`src/components/appointments/DayPlanBoard.tsx:81-119`) writes optimistically,
  pins the row in `recentlyChanged`, and delegates to `useRowMutation.run()` with a `rollback` closure
  and an `onFailure` predicate.
- `AppointmentStatusPanel.changeStatus()` (`src/components/appointments/AppointmentStatusPanel.tsx:37-64`)
  calls `requestJson` directly and re-implements the same rule with panel-wide pending state.
- The 409-vs-revert decision is **duplicated inline** in both files (`DayPlanBoard.tsx:104-116`,
  `AppointmentStatusPanel.tsx:51-61`).
- Only `requestJson` — the transport — has a test (`src/components/hooks/useJsonMutation.test.ts`).
  The `onFailure`/rollback orchestration and the components' state↔render coupling are uncovered.
- **No DOM environment exists.** `vitest.config.ts` sets neither `environment` nor `globals`; no
  `happy-dom`/`jsdom`/`@testing-library/*` is installed; there are zero `.test.tsx` files.
- Phase 1 (`context/changes/testing-api-contract-harness/`) is recorded `researched` in
  `test-plan.md:87` but is an **empty directory** — there is no harness to inherit.

The gap was a conscious deferral: S-04's plan recorded *"React test infra: Not added… Module 3 owns
it"* and named the consequence — *"a regression there would silently restore rollback-on-conflict"*
(`context/archive/2026-08-21-worker-status-changes/plan-brief.md:33,75`). This change is that pickup.

## Desired End State

`npm test` runs a mixed node + happy-dom suite in one invocation. For each status surface it proves,
against a **forced failure** at the network edge, that:

1. the tile returns to its true state and the worker is told (network failure, 500);
2. a `stale` 409 carrying `current` **resyncs** rather than reverts, while a `slot_taken` 409 without
   `current` reverts — the pair that separates correct code from "any 409 resyncs";
3. `disabled`/`aria-busy` clear after failure so the worker can retry.

The failure taxonomy itself is covered exhaustively and cheaply in one node-env test over a shared
`resolveFailureStatus()`, which both components now call instead of each carrying its own copy.

`test-plan.md` §6.4 stops reading "TBD" and becomes the canonical answer to "how do I add a test for
an optimistic UI mutation in this project?"

### Key Discoveries:

- **Every status label is always on screen as a filter button.** `DAY_PLAN_FILTER_STATUSES` renders
  buttons labelled `Oczekuje` / `W trakcie` / `Gotowe` / `Nie przyjechał` at all times
  (`DayPlanBoard.tsx:178-192`), so a bare `getByText("Oczekuje")` is ambiguous. See Critical
  Implementation Details.
- **The advance button's accessible name encodes the *target* status**, not the current one:
  `` `${APPOINTMENT_STATUS_PRESENTATION[target].label} — ${customerFirstName}, ${HH:MM}` ``
  (`DayPlanBoard.tsx:246`). A `waiting` row's button is named `"W trakcie — Jan, 09:00"`; once the row
  is `in_progress` it is named `"Gotowe — Jan, 09:00"`. This makes the button name a precise,
  unambiguous witness of the row's current status.
- **`slot_taken` is nearly unreachable for real** — the exclusion constraint is partial
  (`supabase/migrations/20260821090000_appointments_and_customers.sql:56-61`) and the PATCH writes only
  `status`, so only `no_show → active` can collide. It must be an injected response.
- **RTL auto-cleanup requires `globals: true`**, which this repo does not set. The existing convention
  imports hooks explicitly (`useJsonMutation.test.ts:1`), so each `.test.tsx` carries its own
  `afterEach(cleanup)`.
- **`.nvmrc` pins `22.14.0`**; `jsdom@30` requires `^22.22.2`. `happy-dom@20` requires only `>=20.0.0`.
- **`day-plan.test.ts:5-18`** already establishes the `entry(overrides)` fixture pattern to mirror.

## What We're NOT Doing

- **Not fixing the §3 vanishing-row defect** (research §3): under an active filter, a failed *second*
  advance unmounts the row together with its error message. Decided out of scope; recorded in Open
  Risks. Note the consequence: this phase closes Risk #1's general failure branch, **not** its sharpest
  known instance.
- **Not asserting the filter interaction or the stat counters.** Scoped out with the above.
- **Not fixing the untriaged batch** from S-04's impl-review — the missing re-entrancy guard on
  `advance()` and the empty-`visible` dead state. Recorded in Open Risks.
- **Not adding `@testing-library/jest-dom`.** Plain Vitest `expect` against DOM properties and
  `textContent` covers every assertion here; skipping it avoids a third dependency and the global
  type-augmentation question entirely.
- **Not touching settings-island rows or `NewAppointmentForm`** — out of the agreed research scope.
- **Not changing `vitest.config.ts`, `ci.yml`, or `.nvmrc`.**
- **Not hardening `resolveFailureStatus` beyond current behaviour.** The extraction is
  behaviour-preserving; validating that `current` is a real enum member is a separate improvement.

## Implementation Approach

Five phases, each independently verifiable. Phase 1 establishes the harness and proves the toolchain
(vitest, eslint, astro check, CI) accepts a `.test.tsx` before any real test depends on it. Phase 2 is
a behaviour-preserving refactor that turns a duplicated rule into a single tested oracle — cheap node
coverage of the whole failure taxonomy, so the expensive DOM phases only have to prove *wiring*.
Phases 3 and 4 cover the two state machines separately, each with its own non-vacuity checkpoint.
Phase 5 turns the result into the durable cookbook entry `test-plan.md` §6 exists for.

Failures are forced **at the network edge only** — `vi.stubGlobal("fetch", …)`, matching both the
existing convention (`useJsonMutation.test.ts:8-12`) and `test-plan.md` §4's rule: *"Prefer mocking
only at the network edge. Never mock internal modules."* No component, hook, or service is mocked.

## Critical Implementation Details

**Label collision — how to identify a row's status.** Every Polish status label is permanently on
screen as a filter button, so `getByText(label)` matches the filter pill, not the row. Identify a
row's current status by the **advance button's accessible name**, which encodes the *next* status:
a row showing `Oczekuje` has a button named `"W trakcie — Jan, 09:00"`. Assert reverts against that
name. Where the `StatusPill` itself must be asserted, scope the query to the row first — reach it via
the row's detail link (`aria-label="Szczegóły wizyty — Jan"`, `DayPlanBoard.tsx:219`) and query
`within()` its containing element. Never query a status label at document scope.

**Terminal statuses have no witness.** Both witnesses above vanish for `done` and `no_show`: the
advance button renders only under `{target && …}` and `nextStatus` returns `null` for terminal statuses
(`DayPlanBoard.tsx:241`), and `aria-current="step"` is set only inside `FORWARD_STEPS.map`
(`AppointmentStatusPanel.tsx:71,83`), which excludes `no_show` entirely. Pin every 409-resync case to a
**non-terminal** `current` (use `in_progress`) so the witness exists. Terminal-status resync is covered
exhaustively and cheaply by Phase 2's node test, which needs no DOM witness at all.

**State sequencing in `AppointmentStatusPanel`.** `changeStatus` sets `pendingTarget` **before** the
await and clears it **after** the failure handling (`AppointmentStatusPanel.tsx:41-63`), so a test
asserting `aria-busy` must observe it while the stubbed `fetch` promise is still unresolved — resolve
the stub manually (a deferred promise) rather than expecting to catch the state after `await`.

## Phase 1: DOM test harness

### Overview

Add the three test dependencies, establish the per-file environment convention, and prove the whole
toolchain accepts a `.test.tsx` — before any meaningful test depends on it.

### Changes Required:

#### 1. Test dependencies

**File**: `package.json`

**Intent**: Add the DOM environment and React testing utilities as devDependencies. `happy-dom` is
chosen over `jsdom` because `jsdom@30`'s engine floor (`^22.22.2`) sits above the pinned `.nvmrc`
(`22.14.0`), which would drag a Node bump into a test phase.

**Contract**: three new `devDependencies` — `happy-dom`, `@testing-library/react`,
`@testing-library/user-event`. No `dependencies` change, no script change, no `vitest.config.ts`
change. `@testing-library/react`'s React peer range is `^18 || ^19`, satisfied by the installed
`react@^19.2.6`.

#### 2. Harness smoke test

**File**: `src/components/appointments/StatusPill.test.tsx` (new)

**Intent**: A small but genuine test that renders `StatusPill` for each status and asserts its Polish
label — proving render, query, per-file environment, and cleanup all work end to end. Its value is
one-time harness proof: the label mapping itself is already guaranteed at compile time by
`Record<AppointmentStatus, …>` (`src/lib/appointment-status.ts:14`), so do not treat this file as
load-bearing coverage.

**Contract**: The file opens with the environment docblock and imports its own cleanup, establishing
the convention every later `.test.tsx` copies:

```tsx
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
```

### Success Criteria:

#### Automated Verification:

- The new test passes and the existing node suite is unaffected: `npm test`
- Lint accepts a `.test.tsx` under the react/react-compiler configs: `npm run lint`
- Type-checking accepts it: `npm run typecheck`

#### Manual Verification:

- `npm install` completes with no `EBADENGINE` warning (absence of a warning has no exit code, so this
  cannot be an automated gate — read the install output)
- `npm test` output shows both node-environment and happy-dom tests in one run
- Total `npm test` wall-clock has not materially regressed

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Shared failure decision

### Overview

Extract the duplicated 409-vs-revert rule into one exported function, wire both components to it, and
cover the entire failure taxonomy in a cheap node-environment test.

### Changes Required:

#### 1. The shared decision

**File**: `src/lib/services/status-failure.ts` (new)

**Intent**: One home for "what status should the row show after this failure", replacing the copy in
each component. Placed in `src/lib/services/` per the extracted-business-logic convention, pure and
Supabase-free like its siblings.

**Contract**: `resolveFailureStatus(from: AppointmentStatus, failure: { status?: number; body?: unknown })`
returns `{ status: AppointmentStatus; resynced: boolean }`. The failure parameter is typed
**structurally rather than importing `MutationFailure`** from `@/components/hooks/useJsonMutation`: no
module under `src/lib/` imports from `src/components/` today, and this must not be the first. The two
fields are the only ones either call site reads, and `MutationFailure` stays structurally assignable,
so both callers pass their existing value unchanged. `resynced` is `true` — with `status` taken from
the failure body's `current` — only when `failure.status === 409` **and** the body carries a truthy
`current`. Every other failure returns `{ status: from, resynced: false }`. The `resynced` flag exists
because `DayPlanBoard`'s `onFailure` must return a boolean to suppress rollback.

**This must be behaviour-preserving.** Do not add validation that `current` is a real enum member —
today both call sites cast without checking, and changing that is out of scope.

#### 2. Taxonomy test

**File**: `src/lib/services/status-failure.test.ts` (new)

**Intent**: Cover every failure shape the route can produce, so the DOM phases only have to prove
wiring rather than re-enumerate status codes at the expensive layer.

**Contract**: One case per row of research §2 — 503, 400 `{error}`, 400 `{errors}`, 404, 409 **with**
`current`, 409 **without** `current`, 500, and a network failure (no `status` at all). Assert both
returned fields in each case. Node environment; no environment docblock.

#### 3. Call-site rewiring

**File**: `src/components/appointments/DayPlanBoard.tsx`

**Intent**: Replace the inline 409 branch in `onFailure` with a call to the shared function, keeping
the surrounding behaviour — including the pin deletion inside `rollback` — exactly as it is.

**Contract**: `onFailure` calls `resolveFailureStatus(from, failure)`; on `resynced` it applies
`status` to the entry and returns `true`, otherwise returns `false` so `useRowMutation` runs
`rollback`. Lines 104-116 shrink; nothing else in `advance()` changes.

#### 4. Call-site rewiring

**File**: `src/components/appointments/AppointmentStatusPanel.tsx`

**Intent**: Same replacement for the panel's if/else.

**Contract**: `changeStatus` calls `resolveFailureStatus(from, result.failure)` and passes the returned
`status` to `setStatus`. The `resynced` flag is unused here — the panel has no rollback to suppress.
Message handling is unchanged.

### Success Criteria:

#### Automated Verification:

- The taxonomy test passes: `npm test`
- Type-checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Diff review confirms the extraction is behaviour-preserving on both call sites — no failure shape
  is now handled differently than before
- A status change still works end to end in the running app on both surfaces

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: DayPlanBoard failure tests

### Overview

Prove the day plan's failure branch through the DOM, against forced failures at the network edge.

### Changes Required:

#### 1. Board failure suite

**File**: `src/components/appointments/DayPlanBoard.test.tsx` (new)

**Intent**: Assert the three agreed groups against a rendered board with a stubbed `fetch`. This file
becomes §6.4's reference test.

**Contract**: A local `entry(overrides)` fixture mirroring `day-plan.test.ts:5-18`, and a board
rendered with no active filter. Groups:

- **Core revert + message** — `fetch` rejects, and separately returns 500: the advance button's
  accessible name returns to its pre-tap value, and the row's `role="status"` paragraph shows
  `"Nie udało się połączyć z serwerem."` / the server message.
- **409 discrimination** — a 409 body `{error, current}` leaves the row at `current` and still shows
  the message; a 409 body `{error}` with no `current` reverts to `from`. Use `current: "in_progress"`,
  never a terminal status — see Critical Implementation Details.
- **Pending lifecycle** — `aria-busy` is `"true"` and the button `disabled` while the request is in
  flight, both cleared after the failure resolves.

Identify rows per the Critical Implementation Details rule — never `getByText` a status label.

### Success Criteria:

#### Automated Verification:

- All new board tests pass: `npm test`
- Linting passes: `npm run lint`
- Type-checking passes: `npm run typecheck`

#### Manual Verification:

- **Non-vacuity check**: comment out the `rollback` body in `advance()` — the revert tests go red;
  restore it. Force `onFailure` to always return `true` — the `slot_taken` test goes red; restore it.
  Confirm all green afterwards.
- Test names read as user-visible outcomes, not implementation details

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: AppointmentStatusPanel failure tests

### Overview

The same three groups against the detail page's separate, panel-wide-pending state machine.

### Changes Required:

#### 1. Panel failure suite

**File**: `src/components/appointments/AppointmentStatusPanel.test.tsx` (new)

**Intent**: Prove the second implementation of the same rule independently — it shares no state code
with the board, so board coverage says nothing about it.

**Contract**: Render the panel with `id`, `status`, `customerPhone`. Assert the current status via the
step button carrying `aria-current="step"` — the panel has no `StatusPill`. That attribute exists only
on `FORWARD_STEPS` buttons, so the resync case must target `in_progress`, not `no_show`. Step buttons are queried
by role within the `role="group"` / `aria-label="Status wizyty"` container; their accessible names
concatenate label and note (e.g. `Oczekuje Klient zapisany`), so match on a pattern rather than an
exact string. Same three groups as Phase 3, plus the panel-specific detail that **every** step button
re-enables after a failure, not only the one tapped (`isPending` is panel-wide,
`AppointmentStatusPanel.tsx:35`).

Per Critical Implementation Details, the `aria-busy` assertion requires a deferred `fetch` stub
resolved by the test, since `pendingTarget` is cleared before `changeStatus` returns.

### Success Criteria:

#### Automated Verification:

- All new panel tests pass: `npm test`
- Linting passes: `npm run lint`
- Type-checking passes: `npm run typecheck`

#### Manual Verification:

- **Non-vacuity check**: replace the `setStatus(...)` in the failure branch with a no-op — the revert
  tests go red; restore. Force the 409 branch to always resync — the `slot_taken` test goes red;
  restore. Confirm all green afterwards.
- The panel-wide re-enable assertion genuinely fails if `pendingTarget` is left set

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Cookbook and rollout bookkeeping

### Overview

Turn what this phase learned into the durable §6.4 entry, and correct the rollout table's drift from
what is actually on disk.

### Changes Required:

#### 1. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.4's `TBD` with the real recipe, and record the phase's surprises in §6.6.

**Contract**: §6.4 gains location (colocated `*.test.tsx` beside the component), naming, reference test
(`DayPlanBoard.test.tsx`), run command (`npm test`), and the two conventions this phase established —
the per-file `// @vitest-environment happy-dom` docblock and the explicit `afterEach(cleanup)` (because
`globals` is not set). It must also carry the label-collision rule, which is the single most likely
thing to trip the next author. §6.6 gains two or three lines: happy-dom over jsdom and why, and the
network-edge-only mocking rule holding in practice.

#### 2. Stack and gates

**File**: `context/foundation/test-plan.md`

**Intent**: Keep §4 and §5 truthful now that a DOM layer exists.

**Contract**: §4's `unit` row notes that island tests run under happy-dom via a per-file docblock. §5
needs no new row — the new tests run inside the existing, already-required `unit` gate via `npm test`;
state that explicitly rather than leaving it inferred.

#### 3. Rollout status correction

**File**: `context/foundation/test-plan.md`

**Intent**: §3 is stale in two rows (research §Open Questions #5). Correct both.

**Contract**: The Phase 3 row moves to `complete` with this change folder named. The Phase 1 row is
corrected from `researched` to `not started` with its folder cell reset — the folder is empty, so the
recorded status is unbacked and would mislead the orchestrator's next-handoff derivation.

#### 4. Agent-facing convention

**File**: `AGENTS.md`

**Intent**: The testing paragraph currently names only `*.test.ts` colocated with `src/lib/services/`
modules. A future agent writing a component test needs to know the `.tsx` convention exists.

**Contract**: One sentence in the existing testing paragraph pointing at colocated `*.test.tsx`
component tests, the per-file happy-dom docblock, and `test-plan.md` §6.4 as the full recipe.

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm test`
- Linting and formatting pass on the edited markdown: `npm run lint`

#### Manual Verification:

- §6.4 is specific enough that someone could add a new island test without re-reading this plan
- §3's Phase 1 and Phase 3 rows match what is actually on disk
- `AGENTS.md`'s testing paragraph no longer implies `*.test.ts` is the only shape

---

## Testing Strategy

### Unit Tests:

- `status-failure.test.ts` — the whole failure taxonomy against the shared decision, node environment,
  one case per research §2 row
- `StatusPill.test.tsx` — label mapping per status; also the harness smoke test
- `DayPlanBoard.test.tsx` / `AppointmentStatusPanel.test.tsx` — revert + message, 409 discrimination,
  pending lifecycle, per surface

### Integration Tests:

None. Route-level integration is `test-plan.md` §3 Phase 1's job and this phase does not depend on it.

### Manual Testing Steps:

1. Run `npm test` and confirm node and happy-dom suites both execute in the single invocation
2. Non-vacuity, board: break `rollback`, confirm red, restore, confirm green
3. Non-vacuity, panel: no-op the failure-branch `setStatus`, confirm red, restore, confirm green
4. In the running app, advance a status on the day plan and on the detail page — both still work after
   the Phase 2 refactor
5. With devtools offline, tap advance on the detail page and confirm the step reverts with a message

## Performance Considerations

happy-dom instantiation adds single-digit to low-tens of milliseconds per DOM test file. With four new
files the effect on `npm test` is negligible, and the node suite is untouched because the environment
is opted into per file rather than set globally.

## Migration Notes

None — additive dependencies plus one behaviour-preserving refactor. No schema, no API, no auth, no
deployment ordering concerns, so `lessons.md`'s "Merging is deploying" rule does not apply here.

## References

- Related research: `context/changes/testing-mutation-failure-ui/research.md`
- Quality contract: `context/foundation/test-plan.md` §2 Risk #1, §3 Phase 3, §6.4
- Prior art — the slice that built this surface and deferred these tests:
  `context/archive/2026-08-21-worker-status-changes/` (`plan-brief.md:33,75`, `reviews/plan-review.md:26-62`,
  `reviews/impl-review.md:105-159`)
- Fixture pattern to mirror: `src/lib/services/day-plan.test.ts:5-18`
- Network-edge mocking precedent: `src/components/hooks/useJsonMutation.test.ts:8-12`

## Open Risks & Assumptions

- **The §3 vanishing-row defect stays live and now stays uncovered.** Under an active filter, a failed
  *second* advance unmounts the row together with its `role="status"` error. Decided out of scope for
  both fixing and testing. This is a known, reachable instance of the very risk this phase exists to
  close — it should be the first candidate for the next change on this surface.
- **Two untriaged items from S-04 remain**: `advance()` has no re-entrancy guard where its sibling does
  (`AppointmentStatusPanel.tsx:38`), and the empty state is gated on `entries.length` rather than
  `visible.length`, so a filter matching nothing renders a blank board with no message.
- **`happy-dom` is less battle-tested than `jsdom`.** No API gap is expected for this markup, but if one
  surfaces, the fallback is `jsdom` plus a `.nvmrc` bump to `^22.22.2`.
- **Assumption**: `npm run typecheck` (`astro check`) covers `.test.tsx` files, since `tsconfig.json`
  includes `**/*` and excludes only `dist`. Phase 1 verifies this rather than assuming it.
- **`resolveFailureStatus` is deliberately unhardened** — it casts `current` without checking it is a
  real enum member, exactly as both call sites do today. A malformed server payload could still set a
  bogus status. Hardening it is a separate, easy follow-up.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DOM test harness

#### Automated

- [x] 1.1 New test passes and existing node suite unaffected
- [x] 1.2 Lint accepts a .test.tsx
- [x] 1.3 Type-checking accepts it

#### Manual

- [x] 1.4 npm install completes with no EBADENGINE warning
- [x] 1.5 npm test shows both node and happy-dom tests in one run
- [x] 1.6 Total npm test wall-clock has not materially regressed

### Phase 2: Shared failure decision

#### Automated

- [ ] 2.1 Taxonomy test passes
- [ ] 2.2 Type-checking passes
- [ ] 2.3 Linting passes

#### Manual

- [ ] 2.4 Diff review confirms the extraction is behaviour-preserving on both call sites
- [ ] 2.5 A status change still works end to end on both surfaces

### Phase 3: DayPlanBoard failure tests

#### Automated

- [ ] 3.1 All new board tests pass
- [ ] 3.2 Linting passes
- [ ] 3.3 Type-checking passes

#### Manual

- [ ] 3.4 Non-vacuity check: broken rollback and forced-true onFailure each turn the matching test red
- [ ] 3.5 Test names read as user-visible outcomes

### Phase 4: AppointmentStatusPanel failure tests

#### Automated

- [ ] 4.1 All new panel tests pass
- [ ] 4.2 Linting passes
- [ ] 4.3 Type-checking passes

#### Manual

- [ ] 4.4 Non-vacuity check: no-op setStatus and forced resync each turn the matching test red
- [ ] 4.5 Panel-wide re-enable assertion fails if pendingTarget is left set

### Phase 5: Cookbook and rollout bookkeeping

#### Automated

- [ ] 5.1 Full suite still green
- [ ] 5.2 Linting and formatting pass on the edited markdown

#### Manual

- [ ] 5.3 §6.4 is specific enough to add a new island test without re-reading this plan
- [ ] 5.4 §3 Phase 1 and Phase 3 rows match what is on disk
- [ ] 5.5 AGENTS.md no longer implies *.test.ts is the only shape
