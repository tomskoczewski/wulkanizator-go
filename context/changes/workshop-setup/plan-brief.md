# Workshop Setup (S-01) — Plan Brief

> Full plan: `context/changes/workshop-setup/plan.md`

## What & Why

The owner needs to tell the system how their workshop runs — how many bays, what hours, which services and how long each takes — because S-02's slot-suggestion algorithm reads exactly that. Closes FR-001, FR-002, FR-003 and unblocks the north-star chain. It's also the app's first real screen, so it establishes the shared shell every later slice renders inside.

## Starting Point

F-01 left a stub: `workshops` has `id`, `name`, `created_at` and nothing else, and `handle_new_user()` already creates a workshop + owner profile at signup — so this slice *completes* a workshop rather than creating one (the roadmap's "owner creates a workshop" wording predates F-01 landing). There are no configuration tables, no app UI beyond the starter's purple-gradient dashboard placeholder, no `zod` despite AGENTS.md mandating it, and pgTAP is the only test runner.

## Desired End State

A new owner signs up, is nudged from the dashboard into `/ustawienia`, and finds six services with durations, one bay, and Pon–Sob hours already there. They rename the workshop, add a bay, bump a duration — everything persists. A worker can reach neither the page nor its API. Cross-workshop reads of the new tables return zero rows.

## Key Decisions Made

| Decision                | Choice                                          | Why (1 sentence)                                                                              |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Working hours model     | Per-weekday rows (open/close + closed flag)     | The brochure and reality both have a shorter Saturday; a single open/close pair can't say that. |
| Bays                    | Named rows with a vehicle-type label            | S-02 needs a stable `bay_id` to hang appointments and the overlap constraint on.                |
| Defaults                | Seeded by the signup trigger                    | Makes "start w 30 minut" a review task instead of a data-entry task; nobody faces an empty screen. |
| Delete semantics        | Soft delete via `is_active`                     | S-02/S-03 keep referencing removed rows for history without a dangling FK.                     |
| App shell               | Built now, unbuilt nav destinations disabled    | S-03 is the north star — it shouldn't have to build chrome and retrofit this page into it.     |
| Onboarding              | Plain settings screen + dashboard nudge         | The brochure designed one screen, not a wizard; seeded defaults make a wizard unnecessary.     |
| Contact details         | Name + optional phone + address                 | FR-001 says "dane kontaktowe", and the trigger's email-local-part name needs to be editable.   |
| Access                  | Owner-only; worker redirected                   | Matches the PRD access matrix verbatim and exercises F-01's role branch for the first time.    |
| Write path              | React island → JSON API routes                  | The brochure's steppers and inline add/remove are inherently interactive; S-02 needs the same pattern. |
| API shape               | Resource routes per entity + zod                | Conventional REST that S-02–S-06 extend; each route small enough to validate tightly.          |
| Feedback                | Inline field errors + optimistic w/ rollback    | Keeps the "czytelne w 2 sekundy" feel and reuses the existing auth error idiom.                |
| Naming                  | Polish routes and copy, English code            | Users see the brochure's copy; the schema stays consistent with F-01's `workshops`/`profiles`. |
| Testing                 | Extend pgTAP only                               | Guards the two things that fail catastrophically (data leak, broken signup); vitest waits for S-02. |
| Ship order              | Feature branch, `db push` before merge          | `lessons.md:5` — merging to `main` *is* the deploy.                                            |

## Scope

**In scope:** three workshop-scoped tables (`bays`, `services`, `working_hours`); `workshops.phone`/`address`; default seeding in `handle_new_user()`; RLS + extended pgTAP; `zod` + service layer + four resource routes; API-aware guard fix; shared `AppShell`; `/ustawienia` screen; dashboard nudge; doc cleanup.

**Out of scope:** workshop create flow (the trigger owns it); first-run wizard; global `global.css` retheme; pricing/revenue fields; hard delete; break windows inside hours; vitest/Playwright; per-bay filtering; weekly view; landing page; auth pages.

## Architecture / Approach

Bottom-up in dependency order. Migration adds the three tables using F-01's exact RLS shape — select scoped by `current_workshop_id()`, insert/update additionally gated on `current_user_role() = 'owner'`, grants listing exactly the operations that have policies, no DELETE anywhere. `handle_new_user()` gains three seeding inserts. Above that, `src/lib/services/workshop-setup.ts` holds every query (RLS supplies the scoping, so no function takes a `workshop_id`), zod schemas live in `src/lib/schemas/`, and six route files expose them. The Astro page server-renders the configuration into a React island that mutates optimistically against those routes.

## Phases at a Glance

| Phase                        | What it delivers                                          | Key risk                                                                 |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Schema, provisioning, RLS | Three tables, seeded defaults, extended pgTAP             | The trigger runs inside every production signup — a bug here breaks signup. |
| 2. Service layer & API       | `zod`, query layer, four resource routes, guard fix       | Grant/policy asymmetry produces silent denials that look like RLS bugs.  |
| 3. App shell                 | `AppShell.astro` + logo, `/dashboard` retrofitted         | Copying the brochure's mock-device frame (`rounded-[28px]`, fixed height) into a real page. |
| 4. Settings screen           | `/ustawienia` island + dashboard nudge                    | Optimistic updates that fail silently when the rollback path is untested. |
| 5. Ship                      | Doc cleanup + numbered production sequence                | Merging before `supabase db push` deploys a page against tables that don't exist. |

**Prerequisites:** F-01 (done, archived); local Supabase stack running; brochure clone at `/Users/tomaszskoczewski/Code/wulkanizator-go-brochure` (present); production Supabase access for Phase 5.
**Estimated effort:** ~3–4 after-hours sessions across five phases; Phase 4 is the largest single chunk.

## Open Risks & Assumptions

- **The trigger is the sharpest edge in this slice.** It runs for every deployed Worker version and `wrangler rollback` doesn't undo it. Mitigated by unconditional seeding inserts, pgTAP shape assertions, and a Phase 5 step that halts the merge if a production signup fails.
- **Pre-existing workshops are backfilled**, not left empty — `working_hours` has no INSERT grant by design, so an un-backfilled old workshop could never acquire hours through the app, and S-02 reads that table. Phase 1 calls the same idempotent `seed_workshop_defaults()` the trigger uses over every existing workshop.
- **Brochure fidelity is a judgement call**, not an automated check. The workshop-details form has no brochure counterpart and follows the same card conventions by extension.
- **Assumption**: 5-minute stepper granularity with a 5-minute floor for service durations — the brochure shows values but not the step.

## Success Criteria (Summary)

- A fresh signup lands on `/ustawienia` with six services, one bay, and Pon–Sob hours already populated, all editable and persisting.
- A worker reaches neither `/ustawienia` (redirect) nor its API routes (403 JSON), and cross-workshop reads return zero rows.
- The screen reads as the brochure's `SettingsScreen` at both 360px and desktop.
