---
project: "Wulkanizator GO"
version: 1
status: draft
created: 2026-08-14
updated: 2026-08-25 # S-04 archived
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Wulkanizator GO

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Tire workshops today run their day on Excel and paper — no clear day plan, no tracking of stored customer tires, no revenue forecast. In peak season (spring/autumn), phone calls and walk-ins overwhelm the schedule, resulting in mixed-up bookings and no visibility into work status. Existing ERPs, CRMs, and calendars are too heavy for a small tire workshop, and none of them ships a tire-storage module — the industry-specific hook. Wulkanizator GO is a "to-do list for today" for workshops with 1–5 bays: setup in 30 minutes, big buttons, minimum fields, two roles (owner / worker). MVP is 3 weeks, after-hours, solo.

## North star

**S-03: Day plan — owner/worker sees all appointments with statuses in a single view** — this is the slice where the loop `setup → add appointment → day plan view` closes end-to-end for the first time, and the app can be put in front of a real workshop owner without embarrassment.

> **North star** — the smallest end-to-end flow whose successful delivery would prove the core product hypothesis; sequenced as early as its dependencies allow, because everything else only matters if it works. Per the interview, the user chose to have the north star cover the full Primary Success Criterion, so I decomposed it into three slices (S-01 setup, S-02 appointment, S-03 view) — it lights up on S-03, where the loop closes.

## At a glance

| ID    | Change ID                    | Outcome (user can …)                                                                             | Prerequisites | PRD refs                                | Status   |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------- | -------- |
| F-01  | role-and-workshop-scope      | (foundation) user role (owner/worker) and workshop scope wired into RLS + route-guard            | —             | Access Control, NFR (GDPR)              | done |
| F-02  | design-system-foundation     | (foundation) brand palette, typography, and component conventions locked in `context/foundation/design-system.md`, with a screen-by-screen mapping directing each slice to its exact brochure screen for near-1:1 reference | —             | NFR (readable in 2 seconds)             | done |
| S-01  | workshop-setup               | register the workshop and configure bays, working hours, and services with duration              | F-01          | FR-001, FR-002, FR-003                  | done |
| S-02  | add-appointment-with-slots   | add an appointment (walk-in or existing customer) by picking a service and a suggested free slot | S-01          | US-01, FR-004, FR-005, FR-009 (walk-in) | done |
| S-03  | day-plan-view                | see the day plan with all appointments and their statuses in one view (click = details)          | S-02          | FR-006, FR-008                          | done |
| S-04  | worker-status-changes        | (worker) change an appointment's status on the day plan: waiting → in progress → done / no-show  | S-03, F-01    | FR-007, FR-005 (slot release)           | done |
| S-05  | customer-directory           | manage the customer directory — add, search, assign a returning customer with car(s) to a visit  | S-02          | FR-009 (full card)                      | proposed |
| S-06  | tire-storage                 | take a customer's tires into storage and track state (who owns them, where they sit)             | S-05          | FR-010 (nice-to-have)                   | parked   |

## Streams

Navigation aid — groups slices that share a prerequisites chain. The canonical order lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                            | Note                                                                                        |
| ------ | ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| A      | Core loop (north star)    | `F-01` → `S-01` → `S-02` → `S-03`                | Critical must-have path; `main_goal: speed` means this is the priority spine.               |
| B      | Worker adoption           | `S-04`                                           | Joins Stream A at `S-03`; also needs the role from `F-01`. Runnable in parallel with C.    |
| C      | Customer directory        | `S-05`                                           | Branches off Stream A at `S-02` (basic walk-in customer already exists); parallel with B.  |
| D      | Tire storage — **parked**   | `S-06`                                          | Parked 2026-08-21, out of MVP scope (see §Parked). Chain kept so it can be picked back up as-is. |

`F-02` (design-system-foundation) is intentionally absent from this table — it has no prerequisites and isn't a hard blocker for any single stream (unlike `F-01`, which gates Stream A). It's cross-cutting: a reference every stream's UI-touching slices can draw on, not a link in one chain.

## Baseline

What's already wired in the codebase as of `2026-08-14` (auto-researched + user-confirmed). Foundations below do NOT re-scaffold these layers.

- **Frontend:** present — Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui (`new-york`); `src/pages/index.astro`, `src/pages/dashboard.astro`.
- **Backend / API:** present (scaffold only) — Astro API routes convention; currently only `src/pages/api/auth/{signin,signup,signout}.ts`.
- **Data:** partial — Supabase client at `src/lib/supabase.ts`; `supabase/migrations/` exists but is **empty** (no domain schema yet).
- **Auth:** present — Supabase Auth (`@supabase/ssr`), `src/middleware.ts` with `PROTECTED_ROUTES`, `/auth/{signin,signup,confirm-email}` wired; per `tech-stack.md`.
- **Deploy / infra:** present — Cloudflare Workers via `wrangler.jsonc` (`compatibility_date: 2026-05-08`); `.github/workflows/ci.yml` (lint + build); `context/deployment/deploy-plan.md` covers the first production deploy.
- **Observability:** absent — no Sentry/Datadog/OTel/pino/winston imports in the tree.

## Foundations

### F-01: User role and workshop scope (RLS + route-guard)

- **Outcome:** (foundation) a `profiles` table exists (`user_id`, `workshop_id`, `role: owner|worker`), the RLS pattern is established (workshop-scoped + role-scoped), and `src/middleware.ts` is role-aware. Everything downstream can safely add domain tables under this contract.
- **Change ID:** role-and-workshop-scope
- **PRD refs:** Access Control (two roles), NFR (GDPR baseline; customer data accessible only when logged in and within the given workshop), Non-Goals (one account = one workshop)
- **Unlocks:** S-01 (needs an owner with a `workshop_id`), S-04 (needs the `worker` role), and every domain table in S-02–S-06 (inherits the RLS pattern).
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Done too late — every subsequent table needs a follow-up migration that re-adds `workshop_id` and policies. Done too much — we start building full user management (invites, role editor, audit) which is out of MVP scope. The minimum bar: `profiles` table + one `requireRole()` helper in the middleware.
- **Status:** done

### F-02: Design system foundation (brochure as the canonical UI reference)

- **Outcome:** (foundation) the visual language already validated in the private `wulkanizator-go-brochure` mockup (orange accent on slate neutrals, weight-driven typography, rounded-2xl card/shadow conventions, a 5-way status-color mapping) is captured in `context/foundation/design-system.md`, including an explicit screen-by-screen mapping (roadmap slice → exact brochure screen, with file:line pointers) that directs every UI-touching slice below to open the corresponding brochure screen and replicate it near 1:1, rather than working from memory or inventing its own look. Reference only in this foundation — no `src/` code changes; each slice applies the tokens/layout itself when it builds its screen.
- **Change ID:** design-system-foundation
- **PRD refs:** NFR ("duże przyciski", "czytelne w 2 sekundy", responsive from 360px)
- **Unlocks:** S-01–S-06 (every slice that renders a real screen) — not a hard blocker (they can technically proceed without it), but should land first so no slice has to guess at the look.
- **Prerequisites:** —
- **Parallel with:** F-01 (independent), S-01 if urgency requires it
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Done too late — S-01 through S-04 ship without a documented pointer to their brochure screen and drift from the validated look. Done too heavy — pulling the brochure's marketing copy/landing-page sections into this change, or actually applying tokens to `src/` now; both explicitly out of scope, this foundation is reference-only.
- **Status:** done

## Slices

### S-01: Owner registers the workshop and configures bays, hours, services

- **Outcome:** on first login the owner creates a workshop (name + minimum details), defines bays (1–5), working hours (7:00–18:00 default), and services (name + duration). Setup completable inside the "30 minutes" promise.
- **Change ID:** workshop-setup
- **PRD refs:** FR-001, FR-002, FR-003
- **Brochure reference:** `SettingsScreen` (brochure `src/App.jsx:715`) — "Czasy usług", "Stanowiska", "Godziny pracy" sections mirror FR-001–003 directly. See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Does the day plan get a per-bay filter for workers by default (from Socratic on FR-006)? — Owner: user. Block: no.
- **Risk:** "Setup in 30 minutes" is a marketing promise in the PRD; if the setup UI also forces pricing, integrations, etc., we break the promise. Keep the bar absolute: price can be `null`, only `duration_min` is required.
- **Status:** done

### S-02: Owner adds an appointment with free-slot suggestions

- **Outcome:** the owner picks a service, enters customer data (walk-in: first name + phone; or picks an existing customer), the system suggests the nearest free slots (based on service duration and current bookings on each bay), the owner clicks a slot, the appointment lands on the day plan with status `waiting`, and the slot is locked on that bay.
- **Change ID:** add-appointment-with-slots
- **PRD refs:** US-01, FR-004, FR-005, FR-009 (minimum walk-in customer — first name + phone; full directory lives in S-05)
- **Brochure reference:** `AddVisitScreen` (brochure `src/App.jsx:402`) — slot-suggestion chips, service picker; also see `MobilePreview` (`src/App.jsx:876`) for the mobile variant. See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Do we ship an "add now" option for walk-ins that skips slot suggestions (Socratic on FR-004)?~~ Resolved during planning: **no** — every appointment goes through a suggested slot, keeping one code path and one invariant.
  - ~~Is the number of suggested slots capped (nearest 5? 10?)?~~ Resolved during planning: **nearest 6**, rolling into the next open working day when today is full.
- **Risk:** This is the product's domain core — the slot algorithm plus a hard block on overlapping appointments (a PRD guardrail). A bug in the constraint = two appointments at the same bay at the same time = a regression worse than paper. Enforce validation both at the zod boundary (API) and at the DB level (exclusion constraint over `tstzrange` per `bay_id`).
- **Status:** done

### S-03: Day plan — appointments with statuses (north star)

- **Outcome:** the owner/worker, after logging in, sees the day plan as a chronological list — stat tiles, five status filter pills, and a time-ordered appointment card per visit with a color-coded status pill. Tapping a card opens the visit's detail page. View is readable within 2 seconds per the NFR.
- **Change ID:** day-plan-view
- **PRD refs:** FR-006, FR-008
- **Brochure reference:** `TodayScreen` (brochure `src/App.jsx:293`) — the north star's direct 1:1 mockup: stat tiles, status filters, appointment list with `StatusPill` (`src/App.jsx:169`). See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Sort order and status color palette — stick to shadcn tokens or define custom ones?~~ Resolved by F-02: custom palette, documented in `context/foundation/design-system.md` (status-color mapping: waiting=amber, in progress=blue, done=emerald, no-show=rose, cancelled=slate). ~~Sort order~~ Resolved by `day-plan-view` Phase 1: start time ascending, bay name as tie-break.
- **Risk:** This is the north star (see above) — if the S-01 → S-02 → S-03 chain drifts (e.g., appointment `workshop_id` derived differently than in F-01), it will show up here. Keep the view minimal: today + "previous / next day", no weekly view.
- **Status:** done

### S-04: Worker changes appointment status

- **Outcome:** the worker taps an appointment tile on the day plan and moves its status: `waiting → in progress → done`, or `→ no-show`. Big buttons (dirty hands), change visible immediately. `no-show` releases the slot (but keeps the appointment in history).
- **Change ID:** worker-status-changes
- **PRD refs:** FR-007, FR-005 (slot release on `no-show`)
- **Brochure reference:** `VisitDetailScreen`'s "Szybka zmiana statusu" block (brochure `src/App.jsx:478`, status-step buttons ~L503-513) + `StatusPill` (`src/App.jsx:169`). See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - ~~Does the owner get a manual slot override (Socratic on FR-005)?~~ Resolved by `worker-status-changes` Phase 4: no — parked (`roadmap.md:46`), owner-only manual slot override stays out of scope.
  - ~~Are transitions strict (linear) or free (e.g., back from `in progress` to `waiting`)?~~ Resolved by `worker-status-changes` Phase 3/4: guided one-tap forward on both surfaces, but reversible from the detail page — any non-`cancelled` pair is a legal move except a no-op.
- **Risk:** This is the slice where worker adoption is won or lost ("worker forgets to change status" was flagged explicitly in the Socratic on FR-007). If the UX is even mildly click-heavy or form-shaped, the feature loses its value. Hold the line: one tap on a tile = next status.
- **Status:** done

### S-05: Customer directory — full customer card with cars

- **Outcome:** the owner browses, adds, edits, and searches customers; each customer has a phone number + one or more cars (make, model, plate). When adding an appointment (S-02), an existing customer can be selected instead of typed as a walk-in.
- **Change ID:** customer-directory
- **PRD refs:** FR-009 (full customer card — the minimum walk-in form already lives in S-02)
- **Brochure reference:** `ClientsScreen` (brochure `src/App.jsx:539`) for the list/search view + `CustomerProfileScreen` (`src/App.jsx:580`) for the full card. See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Scope-creep risk — a customer card easily grows into visit history, notes, tags. Hold the minimum: customer + cars + simple search by last name / phone / plate.
- **Status:** proposed

### S-06: Tire storage — PARKED

> Parked 2026-08-21, out of MVP scope. Section kept in place (not deleted) so the slice can be un-parked without re-deriving it — see **Park decision** and **Re-entry trigger** below.

- **Outcome:** the owner accepts a customer's tire set into storage (linked to the customer + location: shelf/rack), then searches later: "whose tires do I have?" and "where does customer X's set sit?".
- **Change ID:** tire-storage
- **PRD refs:** FR-010 (nice-to-have)
- **Brochure reference:** `StorageScreen` (brochure `src/App.jsx:630`) for the search/list view + `StorageIntakeScreen` (`src/App.jsx:676`) for the intake form. See `context/foundation/design-system.md` screen-mapping table.
- **Prerequisites:** S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Does tire storage fit within the 3-week after-hours budget (the PRD itself flags this timeline risk in FR-010)?~~ Resolved 2026-08-21: **no** — parked, taking the escape hatch this Unknown itself named ("If not — move to Parked").
- **Park decision (2026-08-21):** FR-010 is the PRD's only `nice-to-have`, and the PRD's own Socratic resolution already conceded the timeline risk ("Jeśli nie zmieści się w 3 tygodniach, zostaje na v2"). No must-have FR depends on it, and nothing in `src/` references tire storage yet — the S-02 plan explicitly deferred the brochure's "Opony" block to S-06 — so parking removes work without leaving a stub behind. The remaining after-hours budget goes to S-03 → S-04 → S-05, the chain that makes the MVP demonstrable.
- **Risk (accepted):** parking costs the industry differentiator ("no calendar has tire storage" from Vision) for the MVP demo; it moves to the v2 pitch. Accepted under `main_goal: speed` / `top_blocker: time`.
- **Re-entry trigger:** S-05 ships with budget left over, or a real workshop asks for storage before v2. Un-parking = flip this Status back to `proposed`, restore the Stream D row and the §Parked bullet, and reopen the GitHub issue; no code was built against it.
- **Status:** parked

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ---------------------------- | ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------ |
| F-01       | role-and-workshop-scope      | Foundation: user role + workshop scope (RLS, route-guard)    | yes                   | Run `/10x-plan role-and-workshop-scope` — unlocks the rest. |
| F-02       | design-system-foundation     | Foundation: brochure screen-mapping as canonical UI reference | yes                   | Run `/10x-plan design-system-foundation` — no prerequisites. |
| S-01       | workshop-setup               | Workshop setup: bays, hours, services                        | no                    | Waits on F-01.                                               |
| S-02       | add-appointment-with-slots   | Add appointment with free-slot suggestions                   | no                    | Waits on S-01.                                               |
| S-03       | day-plan-view                | Day plan — appointments with statuses (north star)           | no                    | Waits on S-02.                                               |
| S-04       | worker-status-changes        | Worker changes appointment status                            | no                    | Waits on S-03 + F-01.                                        |
| S-05       | customer-directory           | Customer directory with cars                                 | no                    | Waits on S-02; parallel with S-04.                           |
| S-06       | tire-storage                 | Tire storage (nice-to-have)                                  | no — **parked**       | Parked 2026-08-21, out of MVP scope. Do not open a change for it. |

## Open Roadmap Questions

1. **Missing user stories for the remaining MVP flows (registration, service configuration, status change, day-plan view)** — Owner: user. Block: `roadmap-wide` (FRs cover these, but formal user stories will make `/10x-plan` acceptance criteria cleaner). Source: PRD Open Q #1.
2. **Are "revenue and forecast" part of the MVP?** — Access Control in the PRD lists them as owner-only permissions, but no FR defines them. Owner: user. Block: `S-05` if yes (adds roughly one more slice); if no — move to Parked. (S-06 was also listed here until it was parked 2026-08-21.) Recommendation given `main_goal: speed`: park.

## Parked

- **Native mobile app (iOS/Android)** — PRD §Non-Goals: MVP is a responsive web app. A native app is post-MVP scope (shape-notes "Forward: tech-stack").
- **Accounting / invoicing integration** — PRD §Non-Goals: the system does not generate invoices.
- **SMS/email notifications to customers** — PRD §Non-Goals: requires a gateway, complicates the MVP.
- **Multi-tenant (multiple workshops on one account)** — PRD §Non-Goals: one account = one workshop; the limit is also baked into F-01.
- **Manual slot override (editing appointment time outside the suggestion grid)** — Socratic on FR-005: possibly post-MVP; deprioritized under `main_goal: speed`.
- **Per-bay / per-worker filter on the day plan** — Socratic on FR-006: possible but non-blocking. Comes back if a worker's view gets too crowded.
- **Bays × time grid view of the day plan** — the locked design reference maps S-03 to `TodayScreen` (a chronological list), not the grid; the grid-shaped brochure screen is `WeekScreen` (brochure `src/App.jsx`), explicitly unmapped to any MVP slice. `day-plan-view` ships the list. Revisit if the per-bay filter above ever ships and a grid becomes the more legible layout.
- **Variable service duration by car type** — Socratic on FR-003: v2; fixed duration per service on MVP.
- **Tire storage (S-06 / FR-010)** — parked 2026-08-21, no longer conditional. The 3-week after-hours budget doesn't close with it in; FR-010 is the PRD's only nice-to-have and already flags this timeline risk, and no must-have FR depends on it. Full rationale and re-entry trigger in §S-06 above.

## Done

(Empty on first generation. `/10x-archive` appends entries here — and flips a matched item's `Status` to `done` — when an archived change's `Change ID` matches. Do NOT pre-populate.)

- **S-01: register the workshop and configure bays, working hours, and services with duration** — Archived 2026-08-21 → `context/archive/2026-08-15-workshop-setup/`. Lesson: —.
- **S-02: the owner picks a service, enters customer data (walk-in: first name + phone; or picks an existing customer), the system suggests the nearest free slots (based on service duration and current bookings on each bay), the owner clicks a slot, the appointment lands on the day plan with status `waiting`, and the slot is locked on that bay.** — Archived 2026-08-21 → `context/archive/2026-08-21-add-appointment-with-slots/`. Lesson: —.

- **F-01: (foundation) a `profiles` table exists (`user_id`, `workshop_id`, `role: owner|worker`), the RLS pattern is established (workshop-scoped + role-scoped), and `src/middleware.ts` is role-aware. Everything downstream can safely add domain tables under this contract.** — Archived 2026-08-15 → `context/archive/2026-08-15-role-and-workshop-scope/`. Lesson: —.
- **F-02: (foundation) the visual language already validated in the private `wulkanizator-go-brochure` mockup (orange accent on slate neutrals, weight-driven typography, rounded-2xl card/shadow conventions, a 5-way status-color mapping) is captured in `context/foundation/design-system.md`, including an explicit screen-by-screen mapping (roadmap slice → exact brochure screen, with file:line pointers) that directs every UI-touching slice below to open the corresponding brochure screen and replicate it near 1:1, rather than working from memory or inventing its own look. Reference only in this foundation — no `src/` code changes; each slice applies the tokens/layout itself when it builds its screen.** — Archived 2026-08-15 → `context/archive/2026-08-15-design-system-foundation/`. Lesson: —.
- **S-03: the owner/worker, after logging in, sees the day plan as a chronological list — stat tiles, five status filter pills, and a time-ordered appointment card per visit with a color-coded status pill. Tapping a card opens the visit's detail page. View is readable within 2 seconds per the NFR.** — Archived 2026-08-21 → `context/archive/2026-08-21-day-plan-view/`. Lesson: —.
- **S-04: the worker taps an appointment tile on the day plan and moves its status: `waiting → in progress → done`, or `→ no-show`. Big buttons (dirty hands), change visible immediately. `no-show` releases the slot (but keeps the appointment in history).** — Archived 2026-08-25 → `context/archive/2026-08-21-worker-status-changes/`. Lesson: —.
