# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-11

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`,
`supabase/tests/` — excluding `context/`, `docs/`, `.claude/`, lockfiles, and
the generated `src/db/database.types.ts`. Window: 30 days to 2026-09-09,
81 commits — ample signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                 | Impact | Likelihood  | Source (evidence — not anchor)                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A worker taps a status, the tile updates, the write never landed — the day plan shows a state the database does not have, and the workshop trusts it.                                                                                   | High   | High        | interview Q1; interview Q2 (lived); `context/archive/2026-08-15-workshop-setup/` impl-review; `context/archive/2026-08-21-worker-status-changes/` impl-review; hot-spot dir `src/components/appointments/` — 10 commits/30d                                                                     |
| 2   | A booking write accepts a slot the workshop cannot serve — a double-booked bay, or a time outside working hours — because the server trusts the client-supplied bay and start time instead of re-deriving them.                         | High   | Medium-High | PRD §Success Criteria (Guardrails: "dwie wizyty na tym samym stanowisku w tym samym czasie to regresja gorsza niż kartki"); PRD FR-005; interview Q1, Q3; `context/archive/2026-08-21-add-appointment-with-slots/` plan-review + impl-review; hot-spot dir `src/lib/services/` — 17 commits/30d |
| 3   | A signed-in user reads or mutates another workshop's data — a customer phone or plate, or an appointment on a bay that is not theirs.                                                                                                   | High   | Medium      | PRD §NFR (RODO baseline: access only when signed in and within the given workshop); interview Q1; `context/archive/2026-08-21-add-appointment-with-slots/` impl-review; hot-spot dir `supabase/migrations/` — 11 commits/30d                                                                    |
| 4   | A change inside one slice silently breaks the neighbouring slice's contract — a just-booked appointment does not appear on the day plan — while every unit test stays green.                                                            | High   | Medium      | interview Q4 (named as the scariest gap); `context/foundation/roadmap.md` §S-03 Risk ("if the S-01 → S-02 → S-03 chain drifts … it will show up here")                                                                                                                                          |
| 5   | The API answers the unhappy path with the wrong thing — a 500 where 400/404/409 belongs, or an error the client can only classify by reading prose — so the UI shows a red error for work that succeeded, or none for work that failed. | Medium | High        | interview Q2 (lived); `context/archive/2026-08-15-workshop-setup/` impl-review; `context/archive/2026-08-21-day-plan-view/` impl-review; `context/archive/2026-08-21-worker-status-changes/` impl-review; hot-spot dir `src/pages/api/` — 16 commits/30d                                        |
| 6   | Signup or the session guard breaks in season and the workshop is locked out entirely during working hours, with no path back except a manual database intervention.                                                                     | High   | Low         | interview Q1; PRD §NFR (availability 7:00–18:00, "awaria w sezonie oznacza utracone wizyty"); `README.md` §Trigger kill-switch; `context/foundation/lessons.md` §"Merging is deploying"                                                                                                         |

**Abuse / security lens.** Risk #2 is the untrusted-input and
server-side-validation-parity scenario; Risk #3 is the authorization / IDOR
and PII-exposure scenario. Resource abuse (rate-limit bypass, mass-triggered
side effects, costly operations in a loop) is **absent by construction** —
the PRD's §Non-Goals park all notification gateways, there is no
unauthenticated write surface, and no operation is expensive enough to be
worth looping. It is deliberately not padded into the map.

Risk #6 is High impact × Low likelihood. Per §1 principle #1 most of its
defence is operational, not a test: the kill-switch runbook in `README.md`
already exists and is the primary control. The rollout adds only the
cheapest testable slice of it (that a fresh signup provisions its workshop
atomically, and that a profile-less session fails closed rather than
half-open) and does not attempt to test deploy ordering, which is a gate,
not a test.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                             | Must challenge                                                                                                                                                  | Context `/10x-research` must ground                                                                                                            | Likely cheapest layer                                                    | Anti-pattern to avoid                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | When the write fails, the tile returns to its true state **and** the user is told — asserted against a forced failure, not a mocked success.                            | "The optimistic update is fine because the happy path works." The entire risk lives in the failure branch.                                                      | How the mutation path signals failure; what rollback restores; how an active status filter interacts with a rolled-back row.                   | unit (hook + island), with an injected failing response                  | Mocking the request to succeed and asserting the optimistic render — that tests nothing.                                                  |
| #2   | A request naming a bay and time the suggestion list did not offer is rejected, and two concurrent requests for the same bay and time end with exactly one appointment.  | "The database exclusion constraint makes this safe." It catches overlap; it does not catch 03:00 on a closed day, nor a malformed time value that still parses. | Where the booking write re-derives versus trusts input; the transaction and conflict semantics; how working-hours bounds enter the write path. | pgTAP (DB invariant + concurrency) plus one route-level integration test | Asserting the suggestion list matches whatever the slot function currently returns — an oracle lifted from the implementation under test. |
| #3   | A session scoped to workshop A gets nothing, or a 403/404, for every read and write naming a workshop-B resource — including ids it guessed, not only ids it was shown. | "RLS is on, so we are covered." A `security definer` routine runs as its owner and bypasses RLS unless it checks scope itself.                                  | Which write paths run as `security definer`; what each policy grants per operation per role; whether worker-role writes are column-scoped.     | pgTAP negative cases, extending the existing suite                       | Testing only the happy tenant. A test that never asserts a denial proves nothing.                                                         |
| #4   | The chain setup → book → day plan → status change completes against a real stack, and the booked appointment is visible with the correct status.                        | "Green unit tests mean the loop works." Every unit passed while the day plan crashed on a malformed query parameter.                                            | Realistic seed and fixture data; sign-in setup for both roles; what "the loop" minimally includes.                                             | one e2e happy path plus one denial path — not a suite                    | An e2e suite that re-tests what units already cover; e2e is the most expensive signal per assertion.                                      |
| #5   | Each unhappy path returns its correct status **and** a parseable JSON body the client can branch on without reading prose.                                              | "It returns an error, so the client will handle it." Classifying by message string is not handling.                                                             | The current error-translation path from database error to HTTP status; the guard's `/api/*` 401/403 contract.                                  | route-level integration tests (needs the harness Phase 1 builds)         | Snapshotting the current response body — that freezes today's bugs as the contract.                                                       |
| #6   | A fresh signup yields workshop, profile, and default services/bays/hours atomically; a session without a profile row is signed out rather than left half-authenticated. | "The trigger works, it has been running for months." A migration that breaks it fails inside the auth insert, and a Worker rollback does not undo it.           | The trigger's transactional boundary and what it seeds; the fail-closed path in the route guard.                                               | pgTAP on the trigger, plus the existing route-guard unit test            | Building a deploy-ordering test. That is a checklist and a gate, not a test.                                                              |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name           | Goal (one line)                                                                                                                  | Risks covered         | Test types          | Status       | Change folder                                  |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------- | ------------ | ---------------------------------------------- |
| 1   | API contract harness | Prove unhappy paths answer with the right status and a client-parseable body, and give route tests somewhere to live             | #5, #3 (partial)      | integration         | not started  | — (see note 1)                                 |
| 2   | Booking invariants   | Prove a slot the workshop cannot serve is rejected, concurrent bookings cannot both win, and workshop-B resources stay invisible | #2, #3                | pgTAP + integration | implementing | — (see note 2)                                 |
| 3   | Mutation-failure UI  | Prove a failed write is visibly a failed write — rollback restores truth and the user is told                                    | #1                    | unit                | complete     | `context/changes/testing-mutation-failure-ui/` |
| 4   | Core-loop e2e        | Prove the four-slice chain works as one flow, plus one cross-workshop denial and atomic signup provisioning                      | #4, #6, #2 (backstop) | e2e + pgTAP         | implementing | — (see note 3)                                 |
| 5   | Quality-gates wiring | Lock the floor in CI so the gates are enforced rather than remembered                                                            | cross-cutting         | gates               | implementing | — (see note 4)                                 |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

**Reconciliation with disk, 2026-09-11.** Phases 2, 4 and 5 read `not
started` while assertions for them were already green — tests landed
_inside feature changes_ and through `/10x-e2e`, not through their own
rollout change folders, so nothing updated this table. Statuses below are
now what the disk actually supports; `implementing` means real coverage
exists and the phase's stated goal is not yet fully met. What is still
outstanding per phase:

1. **API contract harness — genuinely `not started`.** Nothing under
   `src/pages/api/` has a test; there is no route-level harness. The folder
   `context/changes/testing-api-contract-harness/` exists but is empty (no
   `change.md`), so it is a stub, not an opened change. This phase remains
   the prerequisite the ordering rationale below describes.
2. **Booking invariants — pgTAP half landed, integration half outstanding.**
   `supabase/tests/rls_workshop_scope.test.sql` already proves the overlap
   guard rejects a double-booked bay, that a released `no_show` window is
   re-bookable (the partial-index regression), that the loser of a
   concurrent `book_appointment()` race leaves no orphan customer, and that
   the RPC rejects a bay or service belonging to another workshop. These
   arrived with `context/archive/2026-08-21-add-appointment-with-slots/`,
   `2026-08-21-worker-status-changes/` and
   `2026-08-25-customer-dedupe-on-booking/`. Not yet covered: a booking
   request for a time **outside working hours / on a closed day**, and the
   route-level half, which waits on Phase 1.
3. **Core-loop e2e — e2e half landed, Risk #6 half outstanding.**
   `e2e/core-loop.spec.ts` (Risk #4) walks booking → day plan → detail
   against a real stack; `e2e/cross-workshop-denial.spec.ts` (Risk #3)
   asserts denial survives to what the browser renders; `e2e/seed.spec.ts`
   is the Risk #1 exemplar and `e2e/signout.spec.ts` covers session
   teardown. Delivered via `/10x-e2e` without its own change folder. Not yet
   covered: **atomic signup provisioning** (Risk #6). The pgTAP suite pins
   the trigger's _seeded catalogue_ (1 bay, 6 services, 7 working-hours rows
   per workshop) but never asserts atomicity — that a failing
   `handle_new_user()` rolls the whole `auth.users` insert back rather than
   leaving a user without a profile.
4. **Quality-gates wiring — unit floor locked, expensive layers not.**
   `.github/workflows/ci.yml` runs lint + `npm test` + typecheck + build on
   every push and PR to `main`; `lefthook.yml` adds pre-commit lint, format,
   typecheck and `vitest related`, plus a pre-push database-types drift
   check. **Neither `npm run db:test` (pgTAP) nor `npm run test:e2e`
   (Playwright) runs in CI** — the two most expensive suites are the two
   nobody is forced to run, which is exactly the "enforced rather than
   remembered" gap this phase names.

Ordering rationale, in one line each. Phase 1 comes first despite Risk #1
outranking Risk #5, because nothing tests `src/pages/api/` today and Phases
2 and 4 both assert against that surface — it is the cheapest layer and a
prerequisite for the others. Phase 2 defends the PRD's own guardrail at the
database boundary, where the invariant is actually enforceable. Phase 3
attacks the highest-likelihood risk once a failure can be injected. Phase 4
is deliberately last and deliberately thin. Phase 5 wires what the first
four built.

## 4. Stack

The classic test base for this project. This rollout is classic-only: an
AI-native layer was considered and dropped (see §7). Tool rows carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                        | Tool                      | Version       | Notes                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                         | Vitest                    | ^4.1.11       | Configured (`vitest.config.ts`, plain `defineConfig` with an `@` alias). Colocated `*.test.ts` against `src/lib/services/`, plus colocated `*.test.tsx` island tests under `src/components/appointments/` running on `happy-dom` via a per-file `// @vitest-environment happy-dom` docblock (see §6.4) — no global `environment`/`globals` is set. |
| integration (API routes)     | none yet — see §3 Phase 1 | —             | No test asserts an API route's status or body today. Phase 1 picks the harness.                                                                                                                                                                                                                                                                    |
| integration (database / RLS) | pgTAP via Supabase CLI    | supabase ^2.x | One suite, `supabase/tests/rls_workshop_scope.test.sql`, run by `npm run db:test`. Local only — not wired into CI (see §5).                                                                                                                                                                                                                        |
| API mocking                  | none yet — see §3 Phase 1 | —             | Prefer mocking only at the network edge. Never mock internal modules.                                                                                                                                                                                                                                                                              |
| e2e                          | Playwright                | ^1.63.0       | Installed 2026-09-11. `playwright.config.ts` (`testDir: e2e/`), a `setup` project that signs in each fixture account once into `playwright/.auth/<role>.json`, and `chromium` running on that `storageState`. Run with `npm run test:e2e`; needs the local stack plus `npm run dev`. Not yet wired into CI — §3 Phase 5 owns that.                 |
| accessibility                | none                      | —             | Out of the current rollout. Accessibility gaps were raised in an archived impl-review; they are a candidate for a future `--refresh`, not this rollout.                                                                                                                                                                                            |

**Stack grounding tools (current session):**

- Docs: Cloudflare docs MCP — verified that `@cloudflare/vitest-plugin` is the current name (renamed from `@cloudflare/vitest-pool-workers`, August 2026; the `cloudflareTest()` plugin replaces `defineWorkersProject`), and that `createTestHarness()` is the current recommendation for Workers integration tests. Context7 not available in current session; checked: 2026-09-09.
- Search: Exa MCP — retrieved the official Astro testing guide (Vitest, the experimental Container API, Playwright). **Caveat carried forward:** withastro/astro issue #15847 reports `getViteConfig()` crashing under Astro 6 with Vitest below 4.1.0. This repo is on Vitest ^4.1.11 and does not use `getViteConfig()`, so it is currently clear; any phase adopting the Container API must not regress into that path. Checked: 2026-09-09.
- Runtime/browser: `claude-in-chrome` MCP available; Playwright not installed. Candidate for the Phase 4 e2e layer only — the multimodal review it could also have driven was dropped (see §7). Not endorsed until Phase 4 grounds the trade-off. Checked: 2026-09-09.
- Provider/platform: Cloudflare MCP (docs, search, execute) available. No Supabase or GitHub MCP in this session; the `supabase` and `gh` CLIs are local. Relevant to §5 only as a way to verify a deployed environment, not as a gate. Checked: 2026-09-09.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                   | Where                        | Required?                 | Catches                                                                                                                                                                                             |
| ---------------------- | ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint + typecheck       | local (pre-commit) + CI      | required — wired          | syntactic and type drift                                                                                                                                                                            |
| unit                   | local + CI                   | required — wired          | logic regressions in extracted services, plus (since §3 Phase 3) optimistic-mutation UI regressions on the day plan and status panel — both run inside this same `npm test` gate, no new row needed |
| generated-types drift  | local (pre-push)             | required — wired          | schema changes not reflected in `src/db/database.types.ts`                                                                                                                                          |
| API route integration  | CI on PR                     | required after §3 Phase 1 | wrong status codes and unparseable error bodies                                                                                                                                                     |
| pgTAP RLS + invariants | CI on PR                     | required after §3 Phase 2 | cross-workshop leakage, double-booked bays, non-atomic signup                                                                                                                                       |
| e2e on the core loop   | CI on PR                     | required after §3 Phase 4 | cross-slice drift that unit tests cannot see                                                                                                                                                        |
| pre-prod smoke         | between merge and production | optional                  | environment-specific failures; the merge-is-deploying hazard in `lessons.md`                                                                                                                        |

The pgTAP row names a standing gap: `npm run db:test` exists and passes
locally but runs in no pipeline, so every RLS assertion the project already
owns is currently unenforced. §3 Phase 5 wires it.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test for extracted business logic

- **Location**: colocated `*.test.ts` next to the module under test, in `src/lib/services/`.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/services/slot-suggestions.ts` / `.test.ts`.
- **Run locally**: `npm test` (or `npm run test:watch`).

### 6.2 Adding an integration test for an API route

- TBD — see §3 Phase 1, for the wrong-status-code and unparseable-error-body pattern (Risk #5).

### 6.3 Adding a database invariant or RLS test

- TBD — see §3 Phase 2, for the double-booked-bay, out-of-hours, and cross-workshop-denial patterns (Risks #2, #3). Extends the existing `supabase/tests/` suite; run with `npm run db:test`.

### 6.4 Adding a test for an optimistic UI mutation

- **Location**: colocated `*.test.tsx` next to the component under test, e.g. `src/components/appointments/`.
- **Naming**: `<Component>.test.tsx`.
- **Reference test**: `src/components/appointments/DayPlanBoard.test.tsx`.
- **Run locally**: `npm test` (runs in the same invocation as the node suite).
- **Environment convention**: this repo does not set a global `environment` or `globals` in `vitest.config.ts`. Every DOM test opens with a per-file docblock, `// @vitest-environment happy-dom`, and imports `afterEach(cleanup)` from `@testing-library/react` explicitly — RTL auto-cleanup needs `globals: true`, which is not set. Copy the two-line preamble from `StatusPill.test.tsx` or `DayPlanBoard.test.tsx`.
- **Failure injection**: force the failure at the network edge with `vi.stubGlobal("fetch", …)`, never by mocking an internal module, hook, or component. This mirrors `useJsonMutation.test.ts` and lets the same test exercise the real `resolveFailureStatus()` wiring.
- **Label-collision rule**: every status label (`Oczekuje` / `W trakcie` / `Gotowe` / `Nie przyjechał`) is permanently on screen as a filter button, so a bare `getByText(label)` is ambiguous — it can match the filter pill instead of the row. Identify a row by the advance button's accessible name instead, which encodes the _target_ status (e.g. `"W trakcie — Jan, 09:00"`), or scope a `StatusPill` query with `within()` on the row reached via its detail link. Never query a status label at document scope.
- **Terminal-status witness gap**: `done` and `no_show` have no DOM witness for their current status (no advance button, no `aria-current="step"`). Pin any 409-resync DOM case to a non-terminal `current` (`in_progress`); terminal-status resync is covered by the node-level `status-failure.test.ts` instead, which needs no DOM witness.

### 6.5 Adding an e2e test for a user flow

- **Location**: `e2e/<scenario>.spec.ts`, one test per file.
- **Reference test**: `e2e/seed.spec.ts` is the seed exemplar — every new spec is modeled on it.
- **Rules**: `CLAUDE.md` § _E2E Testing Rules_ (generic) and `e2e/README.md` (this app's four:
  island hydration, the per-spec wall-clock window, SQL setup/teardown, the worker-safe stamp).
- **Run locally**: `npm run test:e2e`, or `npx playwright test e2e/<file>.spec.ts --project=chromium`
  for one spec. Requires `npm run db:start` + `npm run dev`.
- **Workflow**: `/10x-e2e` — plan → generate → review against the five anti-patterns → verify green,
  then verify red by deliberately breaking the behavior the risk names. A denial test additionally
  needs a _positive control_ (the entitled session sees what the denied one does not), otherwise a
  green run proves nothing.
- **Landed so far** (standalone `/10x-e2e` runs on 2026-09-11, outside the §3 Phase 4 change folder):
  Risk #4 (`core-loop.spec.ts`), Risk #3's denial path (`cross-workshop-denial.spec.ts`), plus
  Risk #1's database round trip (`seed.spec.ts`) and a partial Risk #6 guard check
  (`signout.spec.ts`). Phase 4 still owns the atomic-signup pgTAP half and the CI wiring.

### 6.6 Per-rollout-phase notes

(Filled in as phases land — anything surprising a rollout phase taught, in two or three lines.)

- **§3 Phase 3 (Mutation-failure UI)**: `happy-dom` was chosen over `jsdom` because `jsdom@30`'s Node
  engine floor (`^22.22.2`) sits above this repo's pinned `.nvmrc` (`22.14.0`) — picking `happy-dom`
  avoided dragging a Node bump into a test-infra phase. No API gap surfaced for the markup under test.
- The network-edge-only mocking rule (§1, `useJsonMutation.test.ts` precedent) held in practice for
  both DOM suites and the node-level taxonomy test — no component, hook, or service needed an
  internal mock to force any of the eight failure shapes.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui component internals (`src/components/ui/`)** — vendored from upstream; the upstream project is the test. Re-evaluate if a component is forked and hand-modified. (Source: Phase 2 interview Q5.)
- **Visual and snapshot tests of screens, including AI-native multimodal review** — brochure-driven layouts change often; snapshots break constantly and catch nothing. A multimodal review of the day plan at 360px against the PRD's readability NFR was proposed during synthesis and **dropped on 2026-09-09**: the team read it as the same exclusion, baseline or no baseline. This rollout is therefore classic-only. Re-evaluate if a rendering regression ever reaches a real workshop. (Source: Phase 2 interview Q5, plus the 2026-09-09 drop decision.)
- **Parked slices S-05 customer-directory and S-06 tire-storage** — no test budget until they un-park. Re-evaluate on the re-entry triggers recorded in `context/foundation/roadmap.md`. (Source: Phase 2 interview Q5.)
- **Resource-abuse and rate-limit scenarios** — no surface exists: no notification gateway, no unauthenticated write path, no loop-worthy expensive operation. Re-evaluate if any of those ship. (Source: §2 abuse lens.)
- **Generated types and Astro framework behaviour** — `src/db/database.types.ts` is generated and already guarded by the pre-push hook; Astro's routing and SSR are the framework's responsibility. _Derived during synthesis, not stated in Q5_ — challenge it at the next refresh if it does not match what the team believes. (Source: derived.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-09
- Stack versions last verified: 2026-09-09
- AI-native tool references: none in this plan (layer dropped 2026-09-09, see §7)
- Rollout statuses (§3) last reconciled against disk: 2026-09-11

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
