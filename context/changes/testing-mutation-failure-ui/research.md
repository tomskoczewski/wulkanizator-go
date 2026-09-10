---
date: 2026-09-10T14:00:32+02:00
researcher: tomaszskoczewski
git_commit: 6eceb57b0f4963ce019f4d7b0e92692755139ff9
branch: main
repository: wulkanizator-go
topic: "Risk #1 — a failed appointment-status write must be visibly a failed write"
tags: [research, codebase, day-plan, optimistic-update, rollback, useRowMutation, appointment-status, test-tooling]
status: complete
last_updated: 2026-09-10
last_updated_by: tomaszskoczewski
---

# Research: Risk #1 — a failed appointment-status write must be visibly a failed write

**Date**: 2026-09-10T14:00:32+02:00
**Researcher**: tomaszskoczewski
**Git Commit**: 6eceb57b0f4963ce019f4d7b0e92692755139ff9
**Branch**: main
**Repository**: wulkanizator-go (`https://github.com/tomskoczewski/wulkanizator-go`)

> Permalinks below use commit `6eceb57`. Note that `context/foundation/test-plan.md` and this change
> folder are **untracked** at that commit — references to them are local paths only.

## Research Question

From `context/foundation/test-plan.md` §3 Phase 3 (Mutation-failure UI), covering §2 Risk #1:

> A worker taps a status, the tile updates, the write never landed — the day plan shows a state the
> database does not have, and the workshop trusts it.

Scope agreed at research time (interactive): **both** appointment-status surfaces — `DayPlanBoard`
(dashboard) and `AppointmentStatusPanel` (detail page). Settings-island rows and `NewAppointmentForm`
are out of scope. Test tooling is to be **grounded, not chosen** — `/10x-plan` owns the decision.

## Summary

Three findings, in order of consequence.

**1. The rollback machinery exists and is mostly correct; nothing asserts it.** Both surfaces
implement optimistic-update-then-revert, plus a 409-resync refinement that reads the server's true
status. Not one line of that failure branch is covered by a test. This was a *conscious* deferral at
build time — S-04's plan named React test infrastructure as out of scope and handed it to Module 3
by name (`context/archive/2026-08-21-worker-status-changes/plan-brief.md:33`), recording the exact
consequence: "A regression there would **silently restore rollback-on-conflict**" (`plan-brief.md:75`).
This change is that promised pickup.

**2. There is a reachable hole where the failure is invisible — and it was opened by a fix.** Under
an active status filter, a row that was already advanced once successfully will, on a *second*
advance that fails, disappear from the board entirely and take its own error message with it. The
worker sees the card vanish and is told nothing; the database holds a status the board no longer
displays. This is Risk #1 in its literal form. See §3 for the trace and the lineage (plan-review F2
created the pin that prevents it; impl-review F8 deleted the pin on rollback and re-opened it for
this case).

**3. Testing this costs new tooling, and Phase 1 left nothing to inherit.** There is no DOM
environment in the repo — `vitest.config.ts` sets neither `environment` nor `globals`, and no
`jsdom`/`happy-dom`/`@testing-library/*` is installed. `context/changes/testing-api-contract-harness/`
is recorded in `test-plan.md:87` as `researched` but is **an empty directory** — verified directly.
Whatever harness Phase 1 chose was never written down, so this phase would introduce the repo's
first DOM-environment test config rather than extend an existing one.

## Detailed Findings

### 1. Two surfaces, two hand-written implementations of one rule

The same conceptual behaviour is implemented twice, differently.

**`DayPlanBoard` delegates to the shared hook.** `advance()` applies the optimistic write, pins the
row, then calls `useRowMutation.run()` with a `rollback` closure and an `onFailure` predicate
([DayPlanBoard.tsx:81-119](https://github.com/tomskoczewski/wulkanizator-go/blob/6eceb57b0f4963ce019f4d7b0e92692755139ff9/src/components/appointments/DayPlanBoard.tsx#L81-L119)).
Pending and error state are **keyed by appointment id**
([useJsonMutation.ts:113-160](https://github.com/tomskoczewski/wulkanizator-go/blob/6eceb57b0f4963ce019f4d7b0e92692755139ff9/src/components/hooks/useJsonMutation.ts#L113-L160)).

**`AppointmentStatusPanel` calls `requestJson` directly** and re-implements pending/rollback/resync
locally ([AppointmentStatusPanel.tsx:37-64](https://github.com/tomskoczewski/wulkanizator-go/blob/6eceb57b0f4963ce019f4d7b0e92692755139ff9/src/components/appointments/AppointmentStatusPanel.tsx#L37-L64)).
Its `isPending` is a **single panel-wide flag** (`pendingTarget !== null`, line 35), so on rollback
every button in the panel re-enables at once, not just the one that failed.

Consequences for a test author:

| | `DayPlanBoard` | `AppointmentStatusPanel` |
|---|---|---|
| Transport | `useRowMutation.run()` | `requestJson()` direct |
| Pending state | per-row (`isPending(id)`) | panel-wide (`pendingTarget`) |
| Re-entrancy guard | **none** — relies on `disabled` alone | explicit (`if (isPending \|\| !isTransitionAllowed(...)) return`, line 38) |
| Error surface | per-row `<p role="status">` **inside the row** | one `<p role="status">` at panel level |
| Extra state | `recentlyChanged` filter pin | none |

The 409-resync decision — *"if 409 and body carries `current`, resync to it; otherwise revert to
`from`"* — is duplicated inline in both files (`DayPlanBoard.tsx:104-116`,
`AppointmentStatusPanel.tsx:51-61`). Two copies of one rule is the shape that drifts.

### 2. Server failure taxonomy — what a test can force, and what the client should do

Traced from `PATCH /api/appointment-status/[id]` down through `changeAppointmentStatus`
(`src/lib/services/appointments.ts:314-375`) to the schema.

| Outcome | HTTP | Body keys | `current`? | Correct client action | How to force it |
|---|---|---|---|---|---|
| Supabase unconfigured | 503 | `{error}` | no | revert to `from` | unset env — *but see note below* |
| Bad `id` param | 400 | `{error}` | no | revert | non-UUID path segment (`[id].ts:13-16`) |
| Body validation | 400 | `{errors}` | no | revert, show first field error | omit `status`/`from`, or send `cancelled` |
| `illegal` | 400 | `{errors:{status}}` | no | revert | `from === status` (see below) |
| `not_found` | 404 | `{error}` | no | revert | unknown id **or another workshop's id** |
| `stale` | 409 | `{error, current}` | **yes** | **resync to `current`**, still show message | another client moved the row first |
| `slot_taken` | 409 | `{error}` | **no** | revert to `from` | `no_show` → active status, slot re-taken |
| Unhandled throw | 500 | `{error}` | no | revert | any non-`23P01` PG error; any error on the re-read |
| Network failure | — | — | — | revert, "Nie udało się połączyć z serwerem." | `fetch` rejects (`useJsonMutation.ts:66`) |

Four things the taxonomy makes precise:

- **The two 409s differ and both callers handle it correctly.** They gate on `body?.current` being
  present, not on the status code, so `slot_taken`'s current-less 409 correctly falls through to
  rollback. `AppointmentStatus` values are always truthy strings, so there is no falsy-but-present
  edge. No mis-classification found.
- **`illegal` collapses to `from === status`.** `appointmentStatusChangeSchema` already bars
  `cancelled` from both ends (`src/lib/schemas/appointment.ts:25`), so `IS_MUTABLE` in
  `isTransitionAllowed` can never be false for a request that passed zod
  ([appointment-transitions.ts:45-48](https://github.com/tomskoczewski/wulkanizator-go/blob/6eceb57b0f4963ce019f4d7b0e92692755139ff9/src/lib/services/appointment-transitions.ts#L45-L48)).
  Every other in-scope pair is legal, **including backward moves** like `done → waiting`. The 400 is
  a same-status no-op and nothing else.
- **`slot_taken` is nearly unreachable through this endpoint.** The exclusion constraint is partial —
  `where (status not in ('cancelled','no_show'))`
  (`supabase/migrations/20260821090000_appointments_and_customers.sql:56-61`) — and the PATCH writes
  only the `status` column (`20260821151500_appointments_update_status_only.sql:10-11`). A
  `waiting↔in_progress↔done` move is already inside the index and cannot self-conflict. The only
  practical trigger is `no_show → active` after the vacated slot was re-booked. A test wanting that
  branch must set it up deliberately, or inject the response.
- **RLS denial is indistinguishable from "not found".** The `USING` predicate filters rows before the
  update, so a cross-workshop id yields 0 affected rows exactly like a missing one, and both become
  404. Deliberate and non-leaking — but it means a cross-workshop assertion on this route can only
  ever assert 404, never 403.

*Note on the 503:* it is unreachable from the day plan UI. When `locals.supabase` is falsy,
`dashboard.astro:33-35` renders a placeholder instead of mounting `DayPlanBoard` at all — the island
never exists to issue the request.

### 3. FINDING — under a filter, a failed second advance vanishes the row and its error

This is the highest-signal defect found, and it sits exactly on Risk #1.

**Mechanism.** `recentlyChanged` pins a just-advanced row so it stays visible after it falls out of
the active filter (`DayPlanBoard.tsx:65-67`). The set is cleared only by `changeFilter`
(`DayPlanBoard.tsx:78`) — so it **survives a successful advance**. But `rollback` *deletes* the pin
(`DayPlanBoard.tsx:97-101`). Meanwhile `visible` is `filter-matched ∪ pinned` (`DayPlanBoard.tsx:72`),
and the error paragraph renders **inside the row** (`DayPlanBoard.tsx:259-263`).

**Trace** (filter = `Oczekuje`, row A starts `waiting`):

| # | Action | Resulting state | In `visible`? |
|---|---|---|---|
| 1 | — | A is `waiting` | ✅ matches filter |
| 2 | Tap → `W trakcie`, **succeeds** | A is `in_progress`, **pinned** | ✅ via pin |
| 3 | Tap → `Gotowe`, **fails** | optimistic `done`, pin re-added | ✅ via pin |
| 4 | rollback fires | A back to `in_progress`, **pin deleted** | ❌ neither matched nor pinned |

At step 4 `rowErrors[A]` is set (`useJsonMutation.ts:136-139`) but the element that would render it
is unmounted. **The card disappears; no error is shown anywhere.** The database holds `in_progress`;
the board displays nothing for that appointment.

**Preconditions**: an active status filter (never fires under `Wszystkie`, where `filterByStatus`
returns everything — `day-plan.ts:58`) **and** a prior successful advance on the same row. That is
the ordinary worker rhythm: filter to `Oczekuje`, start a car, come back later to finish it, lose
signal in a tyre shop.

**Lineage — this is a re-opened defect, not a fresh one.**

- `worker-status-changes/reviews/plan-review.md:45-62` (**F2**) raised precisely this class of
  failure: *"On failure the inline per-row error renders on a card that is no longer mounted, so a
  failed advance under a filter gives no feedback at all."* Fixed by introducing the pin. Clear
  triggers specified: filter change and day navigation — **rollback was not among them**.
- `worker-status-changes/reviews/impl-review.md:151-159` (**F8**, OBSERVATION) then found the pin was
  never cleared on rollback, stranding a non-matching card, and fixed *that* by deleting the pin
  inside `rollback`.

F8's fix restores F2's failure mode for the second-tap case. Both reviews treated *keep the pin* and
*drop the pin* as the only options, and each loses something:

- **keep pin** → a card showing a status that no longer matches the active filter stays on screen (F8's complaint), but the error is visible.
- **drop pin** → the card is filter-consistent, but a failed write becomes invisible (F2's complaint).

Neither review considered the third option — *keep the pin exactly when the row carries an error* —
which appears to satisfy both. **This is a design decision for `/10x-plan`, deliberately not made
here.** It also determines whether Phase 3's test asserts today's behaviour or a fixed behaviour.

### 4. Secondary observations (each independently verified against current source)

- **Re-entrancy asymmetry.** `AppointmentStatusPanel.changeStatus` guards at the top (line 38);
  `DayPlanBoard.advance` has no equivalent and relies solely on the button's `disabled` attribute.
  Flagged in `worker-status-changes/reviews/impl-review.md:187-189` under "also noted", **never
  formally triaged**, still absent today.
- **Empty-filter dead state.** The empty-state message is gated on `entries.length === 0`
  (`DayPlanBoard.tsx:195`) while the list maps `visible` (line 203). Select a filter no row matches
  and the board renders an empty `<div class="space-y-2">` — no cards, no message, no explanation.
  Same "also noted, never triaged" batch.
- **The 200 body is dead data.** The route returns either a full `DayPlanEntry` or `{id, status}`
  (`[id].ts:29`), and the `updated`-by-convergence path returns `entry: null`
  (`appointments.ts:364`). **Neither caller reads the success body** — `AppointmentStatusPanel`
  declares the union and discards it (line 45), `DayPlanBoard` goes through `requestJson<unknown>`.
  A test asserting the 200 shape would be pinning a contract no production caller depends on.
- **`total` never moves on a status change.** Of the four stat tiles, `total` is `entries.length`
  (`day-plan.ts:45`); only `waiting`/`done`/`noShow` derive from status. `in_progress` has no tile.
  So an optimistic `waiting → in_progress` decrements `Oczekuje` and increments nothing — and a
  rollback must restore it. The counters are a legitimate second assertion surface alongside the pill.

### 5. Test tooling — the options, grounded, not chosen

**Baseline constraints (all verified):**

- `vitest.config.ts` is a bare alias config — **no `environment`, no `globals`**. Every existing test
  is node-environment pure logic.
- Nothing DOM-shaped is installed. Zero `.test.tsx` files exist.
- **Phase 1 left no harness to inherit** — `context/changes/testing-api-contract-harness/` is empty.
- `tsconfig.json` already sets `jsx: "react-jsx"` + `jsxImportSource: "react"` and includes `**/*`,
  so a `.test.tsx` type-checks with no config change. No `types` array is set, so a new dev
  dependency's types are picked up automatically.
- `eslint.config.js` applies the React config to `**/*.{js,jsx,ts,tsx}`, so `react-compiler` and
  `react-hooks` rules **do** apply to a test file. They key off PascalCase/`use*` naming, so a test
  defining no local component or hook should not trip them — worth a spot-check once a real file
  exists, not a blocker.
- **Node engine friction:** `.nvmrc` pins `22.14.0` (confirmed: local `node -v` is `v22.14.0`).
  `jsdom@30` declares `engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0` — **below the floor**. With no
  `engines`/`engine-strict` in `package.json`, this degrades to an `EBADENGINE` warning, not a
  failure. CI floats on `node-version: 22` (`.github/workflows/ci.yml:16`) and would likely resolve
  above the floor — so **CI could be green while a contributor's pinned local Node warns**.
  `happy-dom@20` requires only `>=20.0.0` and has no such conflict.
- **RTL auto-cleanup needs a global `afterEach`**, which requires `globals: true` — not set here. The
  existing convention imports `afterEach` explicitly (`useJsonMutation.test.ts:1`), so each new
  `.test.tsx` would carry its own `afterEach(cleanup)` unless a `setupFiles` entry is added.
- **CI needs no new secrets.** The `npm test` step deliberately carries no env
  (`.github/workflows/ci.yml:21-23`); jsdom/happy-dom are in-process simulators — no browser binary,
  no network. Unlike a future Playwright phase.

| Option | New deps | Config | Proves | Cannot catch |
|---|---|---|---|---|
| **(a) DOM env + Testing Library** | `happy-dom` **or** `jsdom` (engine caveat above); `@testing-library/react@16.3.3` (peer `react ^18 \|\| ^19` — satisfies 19.2.6); `@testing-library/user-event`; optionally `@testing-library/jest-dom` | none required globally — per-file `// @vitest-environment` opt-in keeps the node suite untouched | the whole risk: click → optimistic tile → forced failure → visible revert → `role="status"` text → `aria-busy`/`disabled` | nothing structural; cost is deps + per-file boilerplate |
| **(b) React 19 `act` + manual `createRoot`** | none (ships with `react-dom`) | **still needs a DOM env** — removes the RTL dependency, not the environment one | same ceiling as (a), hand-rolled | no role/accessible-name queries, no realistic event sequencing; easier to drift into asserting CSS selectors |
| **(c) `renderHook` on `useRowMutation`** | `@testing-library/react` (its `renderHook`; the standalone `react-hooks` package is deprecated) — **still needs a DOM env** | per-file env comment | the hook's state machine directly: keyed pending, `rowErrors`, `onFailure` suppression | that the *component* wires `rollback`/`onFailure` correctly; that the tile re-renders; that the message appears |
| **(d) Extract a pure decision fn** | **none** | none — fits the existing `src/lib/services/*.test.ts` pattern exactly | the duplicated 409-vs-revert branch, as one shared tested function | everything DOM-shaped: that the click is wired, that `setEntries` is called with the result, that the message renders, that the row stays mounted (**i.e. it cannot catch §3's defect**) |

Two notes for the cost × signal call:

- Options (b) and (c) do **not** avoid the DOM dependency — only (d) does. If avoiding a DOM env is
  the goal, (d) is the only candidate, and it cannot reach the finding in §3.
- (d) has standalone value regardless of which option wins: the 409-vs-revert branch is currently
  duplicated across both surfaces (§1), and extracting it is a de-duplication with or without tests.
  (d) and (a) are complements, not alternatives.

### 6. What the test must assert, per the plan's own guidance

`test-plan.md` §2 Risk Response Guidance for #1 names the bar: *"When the write fails, the tile
returns to its true state **and** the user is told — asserted against a forced failure, not a mocked
success"*, with the anti-pattern *"Mocking the request to succeed and asserting the optimistic
render — that tests nothing."* Concretely, per surface:

- revert on 500/404/network → pill text returns to the prior Polish label; the `waiting`/`done`/`noShow` counter returns to its prior value
- **resync**, not revert, on a `stale` 409 carrying `current` — and the error message still shows
- revert on a `slot_taken` 409 *without* `current` — the case that distinguishes correct code from "any 409 resyncs"
- the row **stays mounted and the error stays visible** under an active filter (§3)
- `aria-busy`/`disabled` clear after failure so the worker can retry

**Stable selectors** (exact strings, for whichever renderer wins):

- advance button: ``aria-label={`${label} — ${customerFirstName}, ${HH:MM}`}`` (`DayPlanBoard.tsx:246`) — e.g. `"W trakcie — Jan, 09:00"`
- error text: `<p role="status" aria-live="polite">` on both surfaces (`DayPlanBoard.tsx:260`, `AppointmentStatusPanel.tsx:99`)
- step grid: `role="group"` `aria-label="Status wizyty"` (`AppointmentStatusPanel.tsx:70`); active step `aria-current="step"`
- status labels: `waiting`→`Oczekuje`, `in_progress`→`W trakcie`, `done`→`Gotowe`, `no_show`→`Nie przyjechał`, `cancelled`→`Anulowane` (`src/lib/appointment-status.ts:14-20`)
- `StatusPill` has **no** role or `aria-label` (`StatusPill.tsx:9-14`) — matchable by text only

## Code References

- `src/components/appointments/DayPlanBoard.tsx:81-119` — `advance()`: optimistic write, pin, rollback closure, 409-resync
- `src/components/appointments/DayPlanBoard.tsx:72` — `visible` = filter-matched ∪ pinned
- `src/components/appointments/DayPlanBoard.tsx:97-101` — rollback deletes the pin (§3)
- `src/components/appointments/DayPlanBoard.tsx:259-263` — error paragraph, rendered inside the row
- `src/components/appointments/AppointmentStatusPanel.tsx:37-64` — the second, hand-rolled state machine
- `src/components/hooks/useJsonMutation.ts:113-160` — `useRowMutation`: keyed pending/errors, `onFailure` suppression
- `src/components/hooks/useJsonMutation.ts:36-70` — `requestJson`: the only currently-tested piece
- `src/lib/services/appointments.ts:314-375` — `changeAppointmentStatus` outcome union
- `src/lib/services/appointment-transitions.ts:45-48` — `isTransitionAllowed`
- `src/lib/services/day-plan.ts:44-59` — `countByStatus` / `filterByStatus`
- `src/lib/appointment-status.ts:14-26` — labels, pill classes, filter statuses
- `src/pages/api/appointment-status/[id].ts:8-46` — outcome → HTTP mapping
- `src/pages/dashboard.astro:12,24` — server fetch + `client:load` mount
- `src/pages/wizyty/[id].astro:12,54` — UUID pre-check, `client:load` mount
- `supabase/migrations/20260821090000_appointments_and_customers.sql:56-61` — partial exclusion constraint
- `supabase/migrations/20260821151500_appointments_update_status_only.sql:10-11` — status-only column grant

## Architecture Insights

- **Compare-and-set, not last-write-wins.** The update carries `WHERE id = ? AND status = <from>`, so
  zero affected rows means the row moved underneath the caller. That is why a 409 can carry the
  authoritative `current` — and why resyncing to it beats reverting to the client's stale belief.
  The design is sound; it is the *client half* that is unasserted.
- **Non-leaking by construction.** RLS denial collapsing into 404 is a deliberate existence-hiding
  posture, consistent with `getAppointmentDetail`'s documented behaviour (`appointments.ts:288-289`).
- **The hook was generalised under review pressure, not up front.** `useRowMutation` grew
  `status`/`body`/`onFailure` only because a plan-review found the promised 409-resync had no
  transport (see Historical Context). `NewAppointmentForm` had hit the same wall a slice earlier and
  hand-rolled around it instead.
- **The risk lives in the coupling, not in the logic.** Every *pure* piece here is already extracted
  and already tested — transitions, day-plan derivation, `requestJson`. What is untested is precisely
  the part that binds state to render: the `setState` closures inside `advance`/`changeStatus`. That
  is why option (d) alone cannot close the risk, and why §3's defect is a *render* bug rather than a
  logic bug.

## Historical Context (from prior changes)

- `context/archive/2026-08-15-workshop-setup/plan-brief.md:53` — the risk was named **at build time**,
  2026-08-15: *"Optimistic updates that fail silently when the rollback path is untested."* The
  2026-09-10 test plan re-derived it independently as Risk #1.
- `context/archive/2026-08-15-workshop-setup/reviews/impl-review.md:67-96` (F2) — first implementation
  had whole-list snapshot rollback (could resurrect a succeeded mutation) and shared pending state.
  Fix created `useRowMutation` with keyed state and functional rollback.
- `context/archive/2026-08-21-day-plan-view/plan.md:91` — the day plan shipped **read-only**: *"No
  status changes. No buttons, no transitions, no PATCH route. That is S-04."*
- `context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:57-64` (F3) —
  `NewAppointmentForm` bypassed the hook because it couldn't carry a 409 body; documented, not fixed.
- `context/archive/2026-08-21-worker-status-changes/reviews/plan-review.md:26-43` (F1, CRITICAL) — the
  plan promised 409-resync in five places with no mechanism to deliver it. Fixed by extending
  `MutationFailure` with `status`/`body` and adding `onFailure`.
- `context/archive/2026-08-21-worker-status-changes/reviews/plan-review.md:45-62` (F2) → the
  `recentlyChanged` pin. `.../impl-review.md:151-159` (F8) → un-pin on rollback. **Together they
  produce §3.**
- `context/archive/2026-08-21-worker-status-changes/reviews/impl-review.md:137-149` (F7) — the
  *service-side* half of this path was also untested, and two real bugs (F2, F5) were found there.
  Fixed by adding `appointments.test.ts`. **The client-side half was not** — this change is it.
- `context/archive/2026-08-21-worker-status-changes/plan-brief.md:33,75` — React test infra explicitly
  deferred: *"Pinning a useCallback-bound function needs @testing-library/react + jsdom, which this
  repo lacks and Module 3 owns."* Suggested cheapest route at the time: *"extracting the rollback
  decision into an exported pure helper rather than pulling in a renderer"* — i.e. option (d).
- `context/foundation/roadmap.md:150` — S-04's recorded risk is **UX adoption**, not correctness. The
  testing risk never reached the roadmap; it surfaced only through impl-reviews and the test plan.

## Related Research

- `context/foundation/test-plan.md` §2 Risk #1, §3 Phase 3 — the brief this change executes
- `context/changes/testing-api-contract-harness/` — Phase 1; **empty on disk** despite a `researched` status
- `context/archive/2026-08-21-worker-status-changes/` — the slice that built this surface; its two reviews are the richest prior art

## Open Questions

1. **Pin-vs-error precedence (§3) — a decision, not a discovery.** Keep the pin when the row carries
   an error? Move the error out of the row? Something else? This determines whether Phase 3's test
   asserts current behaviour or drives a fix. `/10x-plan` owns it.
2. **Do the two surfaces converge?** Extracting the shared 409-vs-revert decision (option (d)) removes
   a duplicated rule and is worth doing on its own merits — but it is a refactor inside a test phase.
   In or out of scope?
3. **`happy-dom` or `jsdom`, if a DOM env is chosen?** `jsdom@30`'s engine floor sits above the
   pinned `.nvmrc` (`22.14.0`). Options: pick `happy-dom`, bump `.nvmrc`, or accept the warning.
4. **Is the untriaged batch in scope?** The re-entrancy asymmetry and the empty-filter dead state
   (§4) were noted at impl-review and never triaged. Both are adjacent; neither is Risk #1.
5. **`test-plan.md` §3 is stale in two rows.** Phase 1 is recorded `researched` with an empty folder;
   Phase 3 is recorded `not started` while this folder exists. Worth a correction pass at the next
   `/10x-test-plan` invocation — not this change's job.
