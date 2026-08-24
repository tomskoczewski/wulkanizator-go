# Worker Status Changes (S-04) — Plan Brief

> Full plan: `context/changes/worker-status-changes/plan.md`

## What & Why

Roadmap slice **S-04**: a worker moves an appointment through `waiting → in_progress → done`, or marks it `no_show`. This is **FR-007**, and the slot-release half of **FR-005**. The roadmap names this as the slice where worker adoption is won or lost — "if the UX is even mildly click-heavy or form-shaped, the feature loses its value" — so the interaction target is one tap, with dirty hands, on a phone.

## Starting Point

The database work for S-04 already shipped with S-02 and needs **no changes**: both roles can already UPDATE an appointment in their workshop, the grant is already narrowed to the `status` column, and `no_show` already releases the bay window for free via a partial exclusion constraint. pgTAP already asserts the worker-update path.

Everything missing sits above the database: no status service function, no schema, no endpoint; `/api/appointments` is owner-only and prefix-matched so workers can't reach a nested status route; and both UI surfaces are static — the detail page omits the brochure's whole status block, and each day-plan row is a bare `<a>`.

## Desired End State

A worker on `/dashboard` advances any appointment with one tap — pill and stat tiles update instantly, no reload. Tapping the card body still opens `/wizyty/<id>`, where the brochure's three-step "Szybka zmiana statusu" grid, a rose **Nie przyjechał** button, and a slate **Zadzwoń** button live. Anything reachable can be walked back; when it can't be — slot re-booked, or someone else moved the row — the UI says so in Polish rather than silently reverting.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Which surface(s) | Both — day-plan advance + detail block | Honors the roadmap's one-tap adoption bet and the locked brochure screen mapping. |
| Transition strictness | Guided forward, reversible from detail | The list stays a single-tap flow while a mis-tap stays fixable without SQL access. |
| Terminal states | Reversible, with a 409 conflict message | Reversing `no_show` genuinely can fail on a re-booked slot; better to say so than to hide it. |
| Rule enforcement | Pure module + zod at the API boundary | Matches the repo's pure-logic-plus-Vitest pattern; one rule source both UI surfaces import. |
| Endpoint shape | Sibling `PATCH /api/appointment-status/[id]` | Keeps the guard table a dumb auditable prefix list; leaves the owner-only booking API sealed. |
| Concurrency | Compare-and-set (`where status = <from>`) | Detects a concurrent move instead of overwriting it, with no read-then-write round trip. |
| Feedback | Optimistic update, rollback on failure | Meets the sub-2-second NFR from local state and reuses the existing `useRowMutation` hook. |
| Conflict transport | Extend `requestJson`/`useRowMutation` additively | The shared helper drops the HTTP status and body, so a 409's `current` can't reach the caller; extending it beats a third hand-rolled `fetch`. |
| `cancelled` status | Left unreachable | FR-007 defines exactly four states; the day plan already filters `cancelled` out. |
| Test depth | Vitest on the rules, the guard split, and `requestJson`; pgTAP on the DB invariants | Repo expects pure logic to carry tests; pgTAP fixtures already exist and just need assertions. |
| React test infra | Not added — `onFailure` stays manual-only | Pinning a `useCallback`-bound function needs `@testing-library/react` + `jsdom`, which this repo lacks and Module 3 owns. |

## Scope

**In scope:** transition-rules module + tests; zod status schema; conflict-carrying extension to `requestJson`/`useRowMutation` + its unit tests; `changeAppointmentStatus()` service; `PATCH /api/appointment-status/[id]`; guard-table entry + tests; detail-page status block with Zadzwoń and Nie przyjechał; day-plan inline advance; pgTAP assertions; roadmap sync.

**Out of scope:** `cancelled` in the UI; customer history panel (S-05); notes field; DB transition trigger; owner manual slot override (parked); any migration or `db:types` regeneration; e2e harness (Module 3); README route-table edit (it documents pages, not the six `/api/*` prefixes).

## Architecture / Approach

```
appointment-transitions.ts  ──imports──►  DayPlanBoard (one-tap advance)
   (pure rules, tested)     ──imports──►  AppointmentStatusPanel (detail block)
            │                                     │
            └──imports──► changeAppointmentStatus │ optimistic PATCH
                                 │                ◄┘
                    PATCH /api/appointment-status/[id]   (guard: "any")
                                 │
                 UPDATE ... WHERE id = ? AND status = <from>
                     0 rows → 409 stale · 23P01 → 409 slot taken
```

One pure module owns the rules; both UI surfaces read it to decide which buttons are live, and the service reads it to reject illegal moves. No schema changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rules, schema, transport | Tested pure rule module, zod body schema, conflict-carrying mutation helper; nothing wired | Hook change regressing one of the four existing settings callers |
| 2. Service, route, guard, pgTAP | Working worker-reachable endpoint with both 409 paths | Guard entry mis-scoped, re-opening booking to workers |
| 3. Detail page status block | Brochure-faithful status grid + sidebar actions | Layout drift from the brochure's two-column grid |
| 4. Day-plan advance + ship | One-tap advance, optimistic tiles, roadmap sync | Nested `<button>` inside the row `<a>` swallowing clicks; rows vanishing under an active filter |

**Prerequisites:** S-03 (day plan) and F-01 (roles) — both `done`. Local Supabase stack running for `npm run db:test`. Brochure clone present at `~/Code/wulkanizator-go-brochure`.
**Estimated effort:** ~2 sessions across 4 phases; no migration, so no production schema step.

## Open Risks & Assumptions

- Reversibility means a worker can walk a `done` appointment back to `waiting`; if that turns out to be abused in practice, restricting reversal to the owner is a small follow-up (the rule lives in one module).
- The compare-and-set assumes the client always knows the row's current status. Both surfaces do today; any future caller that doesn't will need a read first.
- pgTAP's `plan(48)` count at `rls_workshop_scope.test.sql:11` must be bumped when assertions are added — forgetting it fails the suite in a way that looks unrelated.
- The brochure's orange "Oznacz: Gotowe" sidebar button is deliberately not reproduced; it duplicates the step grid once the grid is interactive.
- `useRowMutation`'s "suppress rollback on 409" branch carries no unit test — it is covered by manual criteria 3.7 and 4.9 only. A regression there would silently restore rollback-on-conflict, the exact behavior this slice adds the transport change to prevent.

## Success Criteria (Summary)

- A worker moves an appointment through its full lifecycle from either surface, with the change visible in well under two seconds and no page reload.
- Marking `no_show` frees the bay window — it reappears among `/wizyty/nowa`'s suggestions — while the appointment stays in history.
- Concurrent or impossible moves produce a clear Polish message and a resynced row, never a silent overwrite.
