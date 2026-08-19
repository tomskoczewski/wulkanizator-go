# Workshop Setup (S-01) Implementation Plan

## Overview

Turn the F-01 stub workshop into a *configured* workshop. The owner gets one screen — `/ustawienia` — where they name their workshop, list their bays, set working hours, and manage services with durations. Three new workshop-scoped tables carry that configuration, seeded with sensible defaults at signup so the owner reviews rather than fills. This is also the app's first real screen, so it establishes the shared brochure-faithful app shell that S-02–S-06 inherit.

Closes FR-001, FR-002, FR-003. Unblocks S-02, whose slot-suggestion algorithm reads exactly these three tables.

## Current State Analysis

**What exists (F-01, archived `context/archive/2026-08-15-role-and-workshop-scope/`):**

- `public.workshops` — `id`, `name`, `created_at` only (`supabase/migrations/20260814235519_role_and_workshop_scope.sql:19`). A stub.
- `public.profiles` — binds one `auth.users` row to one workshop and one role (`owner` | `worker`).
- `public.current_workshop_id()` / `public.current_user_role()` — `security definer`, `set search_path = ''`, execute revoked from `anon` (`…:41-65`). Every downstream policy calls these.
- `public.handle_new_user()` — creates workshop + owner profile atomically on every `auth.users` insert (`supabase/migrations/20260815000433_handle_new_user.sql:12`). Names the workshop after the email local-part.
- `src/middleware.ts` — resolves user + profile, fails closed on a missing profile, delegates to `requireRole()`.
- `src/lib/auth-guard.ts:10` — the route table, currently a single entry: `[["/dashboard", "any"]]`.
- `supabase/tests/rls_workshop_scope.test.sql` — 14 pgTAP assertions with a `pg_temp.authenticate_as()` helper; `supabase/seed.sql` provides owner A / worker A / owner B.

**What's missing:**

- No configuration tables at all. `supabase/migrations/` has exactly the two F-01 files.
- No app UI. `src/pages/dashboard.astro` is still the starter's purple-gradient placeholder; `src/layouts/Layout.astro` is a bare `<html>` shell with a config banner. Nothing resembling the brochure's `AppShell` exists.
- `src/components/ui/` holds only `button.tsx`. `src/styles/global.css` carries stock shadcn *neutral* tokens — the brochure's orange/slate palette is not wired.
- **`zod` is not installed** (`package.json:20-41`), despite AGENTS.md mandating it for API input validation. No existing route validates anything — `src/pages/api/auth/signup.ts:6-7` reads raw `formData` and casts.
- No JS test runner of any kind. pgTAP via `npm run db:test` is the only automated test surface.

**Key constraint discovered — the roadmap's wording is stale.** S-01 says "the owner creates a workshop", but `handle_new_user()` already creates it at signup. This slice therefore *completes* an existing workshop; there is no create path, and no INSERT policy on `workshops` should be added.

## Desired End State

A newly signed-up owner lands on `/dashboard`, sees a prompt to configure their workshop, clicks through to `/ustawienia`, and finds a screen that already contains six services with durations, one bay, and Pon–Sob working hours. They rename the workshop, add a second bay, bump a service duration, and every change persists. A worker signing in cannot reach `/ustawienia` — neither the page nor its API routes. Cross-workshop reads of the new tables return zero rows.

**Verification**: `npm run db:test` passes with the extended suite; `npm run lint`, `npm run typecheck`, `npm run build` pass; the four manual gates in Phase 4 and Phase 5 are confirmed by hand.

### Key Discoveries:

- The RLS pattern to copy is fully worked out in `supabase/migrations/20260814235519_role_and_workshop_scope.sql:73-102`: enable RLS, grant *exactly* the operations that have a policy (Postgres checks table privileges before RLS, so an ungranted operation is denied before RLS is consulted), scope reads with `current_workshop_id()`, gate writes additionally on `current_user_role() = 'owner'`.
- `handle_new_user()` is `security definer` and bypasses RLS — the correct place to seed defaults, and the reason `bays`/`services` need no INSERT policy for the seeding path itself.
- The brochure's `SettingsScreen` (`/Users/tomaszskoczewski/Code/wulkanizator-go-brochure/src/App.jsx:715`) is a 2-column `xl:grid-cols-[1.2fr_.8fr]` layout: "Czasy usług" on the left with −/+ steppers, "Stanowiska" and "Godziny pracy" stacked on the right. Its service fixture (`App.jsx:90-97`) is the exact default catalogue to seed.
- `AppShell` (`App.jsx:247-289`) — `bg-gradient-to-r from-slate-900 to-orange-700` header carrying the `wulkanizator`+`go` lockup and `Logo3D`, a `w-14 bg-slate-950` icon nav rail hidden below `md`, content area `flex-1 overflow-y-auto p-4 bg-slate-50`. The `rounded-[28px]` outer frame and fixed `height: 680` are brochure-presentation artifacts (it renders inside a mock device) and must **not** carry over to real pages.
- `requireRole()` returns `{ type: "redirect" }` only — a 302 answered to a `fetch()` from the settings island would be followed and return HTML, surfacing as a JSON parse error rather than a permission error. The `/api/` branch needs a distinct outcome.

## What We're NOT Doing

- **No workshop create flow** — the signup trigger owns provisioning (see Current State Analysis).
- **No first-run wizard.** One settings screen plus a dashboard nudge; no multi-step state machine.
- **No global retheme.** `global.css`'s shadcn tokens stay as they are; the shell and settings screen use brochure Tailwind classes directly. Auth pages and their styling are untouched.
- **No pricing, revenue, or forecast fields** — Open Roadmap Question #2 is unresolved and `PricingScreen` maps to no current slice. `services.price` is not added.
- **No delete of bays or services** — soft delete via `is_active` only; no DELETE grant or policy on any new table.
- **No break/lunch windows** inside working hours — one open/close pair per weekday.
- **No vitest, no Playwright.** JS test infrastructure is deferred to S-02, where the slot algorithm justifies it.
- **No per-bay filtering, no weekly view, no landing page.**
- **No changes to the auth pages, `Topbar.astro`, `Banner.astro`, or `Welcome.astro`.**

## Implementation Approach

Bottom-up, in the order the layers depend on each other: schema → API → shell → screen → ship. Each phase leaves the repo in a working, verifiable state.

The slice runs on a feature branch `feat/workshop-setup`. Per `context/foundation/lessons.md:5` ("Merging is deploying"), merging to `main` triggers a Cloudflare auto-deploy in ~93s — so the migration must reach production *before* the merge, and Phase 5 is that ship sequence written out as numbered steps.

**Data model summary** (all three new tables workshop-scoped, all inheriting F-01's policy shape):

| Table           | Columns beyond `id` / `workshop_id` / `created_at`                          | Grants to `authenticated` |
| --------------- | --------------------------------------------------------------------------- | ------------------------- |
| `bays`          | `name text not null`, `vehicle_type text`, `is_active boolean not null`      | select, insert, update    |
| `services`      | `name text not null`, `duration_min int not null`, `is_active boolean`       | select, insert, update    |
| `working_hours` | `weekday int (0–6)`, `opens_at time`, `closes_at time`, `is_closed boolean`  | select, update            |

`working_hours` gets no INSERT grant: every workshop gets exactly seven rows — new ones from the signup trigger, pre-existing ones from the Phase 1 backfill — and that set never grows. This invariant only holds *because* the backfill exists; without it an old workshop would have zero hours rows and no way to create any. `bays`/`services` get INSERT (owner adds more) but never DELETE (soft delete).

## Critical Implementation Details

**Trigger fragility.** `handle_new_user()` runs inside every `auth.users` INSERT, for every deployed Worker version. `wrangler rollback` does not undo it (`README.md` "Trigger kill-switch"). A default-seeding bug therefore breaks *signup in production*, not just setup. Two consequences for Phase 1: the seeding INSERTs must be plain, unconditional, and free of anything that can raise (no lookups, no casts that can fail); and the pgTAP suite must assert the seeded shape so a future edit to the function can't silently regress it.

**Grant/policy symmetry.** Adding a policy without the matching table grant produces a silent permission denial that looks like an RLS bug. Every new table's `grant` line must list exactly the operations that have a `create policy` below it — and no more.

**API guard semantics.** `/api/` paths must not receive a 302 (see Key Discoveries). The middleware branch returning JSON must run *before* `context.redirect(...)`, and `/api/auth/*` must stay ungated so sign-in still works.

## Phase 1: Schema, provisioning & RLS

### Overview

Add the three configuration tables with F-01's RLS pattern, extend `workshops` with contact columns, teach the signup trigger to seed defaults, regenerate types, and extend the pgTAP suite to cover the new scope surface.

### Changes Required:

#### 1. Configuration schema

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_workshop_configuration.sql` (new)

**Intent**: Create the three workshop-scoped configuration tables and add the contact columns FR-001 calls for, so the owner has something to configure and S-02 has something to read.

**Contract**: `alter table public.workshops add column phone text, add column address text` (both nullable — `name` stays the only required field). Three new tables per the data-model table in Implementation Approach, each with `workshop_id uuid not null references public.workshops (id) on delete cascade` and an index on it, mirroring `profiles_workshop_id_idx`. `working_hours` carries `unique (workshop_id, weekday)` and a `check (weekday between 0 and 6)`; `services` a `check (duration_min > 0)`. Each table: `enable row level security`, a grant line matching its policy set exactly, a `_select_own_workshop` policy `using (workshop_id = public.current_workshop_id())`, and owner-gated `insert`/`update` policies that add `and public.current_user_role() = 'owner'` — following `20260814235519_role_and_workshop_scope.sql:82-102` verbatim in shape.

#### 2. Default seeding in the signup trigger

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_seed_workshop_defaults.sql` (new)

**Intent**: Replace `handle_new_user()` so a brand-new workshop arrives already populated — six services, one bay, seven weekday rows — making "start w 30 minut" a review task rather than a data-entry task.

**Contract**: Two functions, so the default catalogue has exactly one definition:

- `public.seed_workshop_defaults(p_workshop_id uuid)` (new) — `security definer`, `set search_path = ''`, holding the three default inserts. Idempotent: each insert is guarded so calling it twice against the same workshop adds nothing (`working_hours` already has `unique (workshop_id, weekday)`; `bays`/`services` use a `where not exists` guard on the workshop).
- `create or replace function public.handle_new_user()` — keeps its existing signature, `security definer`, and `set search_path = ''`; calls `seed_workshop_defaults(new_workshop_id)` after its existing `workshops` + `profiles` inserts. The trigger is not recreated (`create or replace` leaves `on_auth_user_created` bound to the new body).

Both functions must be created before the backfill below calls them. Default data:

- Services (from the brochure's fixture, `wulkanizator-go-brochure/src/App.jsx:90-97`): Wymiana kół 30, Wymiana opon 40, Wymiana + wyważanie 45, Wyważanie 20, Naprawa ogumienia 20, Utylizacja 10.
- Bays: one row, `name = 'Stanowisko 1'`, `vehicle_type = 'osobowe'`.
- Hours: weekdays 1–5 `07:00`–`18:00`, weekday 6 `08:00`–`14:00`, weekday 0 `is_closed = true`. (`weekday` follows Postgres `dow`: 0 = Sunday.)

#### 3. Backfill for pre-existing workshops

**File**: same migration as change #2

**Intent**: Give workshops that already exist the same defaults a new signup gets. Without this they are not merely empty — `working_hours` has no INSERT grant by design, so an existing workshop could *never* acquire working hours through the app, and S-02's slot algorithm would have nothing to read for the one production account that matters.

**Contract**: After both functions exist, `select public.seed_workshop_defaults(id) from public.workshops;` — one statement, relying on the idempotency guards above. Runs as the migration role, so RLS and table grants don't apply. Row counts are single-digit; no batching needed.

#### 4. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the committed types in step with the schema — `npm run typecheck` validates against this file, not the live database, so a stale copy is a silent gap (and `.husky/pre-push` will catch it anyway).

**Contract**: Regenerate with `npm run db:types` after `npm run db:reset`. Commit the result.

#### 5. Shared entity types

**File**: `src/types.ts`

**Intent**: Expose the new rows to app code through the same `Database[...]` indirection already used for `Workshop` and `Profile`.

**Contract**: Add `Bay`, `Service`, `WorkingHours` row aliases alongside the existing three exports at `src/types.ts:3-5`. DTOs come in Phase 2.

#### 6. RLS regression coverage

**File**: `supabase/tests/rls_workshop_scope.test.sql`

**Intent**: Extend the existing suite so the new tables are covered by the same cross-workshop and cross-role assertions that guard `workshops`/`profiles`, and so the seeded defaults are pinned against future trigger edits.

**Contract**: Bump `select plan(N)` to the new count. Add, reusing `pg_temp.authenticate_as()`: owner A sees their own bays/services/hours and zero rows of workshop B's; worker A sees the same rows as owner A but their INSERT and UPDATE attempts affect zero rows (via the `get diagnostics` helper pattern at `rls_workshop_scope.test.sql:29-53`); a `throws_ok` on direct DELETE (no grant); and count assertions that workshop A has exactly 6 services, 1 bay, and 7 working-hours rows — the seeded shape.

**Note**: `supabase/seed.sql` needs no change. It creates its users via `auth.users` inserts, so the updated trigger seeds their defaults automatically. The `delete from public.workshops where id not in (...)` at its tail cascades the third workshop's seeded rows away cleanly.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch: `npm run db:reset`
- pgTAP suite passes with the new assertions: `npm run db:test`
- Regenerated types are committed and drift-free: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Signing up a fresh account through `/auth/signup` succeeds (the trigger still permits signup) and Supabase Studio shows the new workshop with 6 services, 1 bay, and 7 working-hours rows.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Service layer, zod validation & API routes

### Overview

Add `zod`, build the query layer, expose four resource routes, and close the access-control gap that would otherwise leave those routes ungated.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Install `zod`, which AGENTS.md mandates for API input validation and which nothing in the repo has needed until now.

**Contract**: `npm install zod`. Commit both `package.json` and `package-lock.json`.

#### 2. Query layer

**File**: `src/lib/services/workshop-setup.ts` (new — first file in this directory)

**Intent**: Hold every Supabase query this slice needs, so route handlers stay thin and S-02 has one place to look for how configuration is read.

**Contract**: Exports one read function returning the full configuration for the current workshop (details + bays + services + hours, active rows only) and per-entity write functions for update-workshop, create/update/deactivate bay, create/update/deactivate service, and update working-hours row. Every function takes a `TypedSupabaseClient` (`src/lib/supabase.ts:27` — already exported, currently unused) as its first argument. RLS supplies the workshop scoping, so no function accepts a `workshop_id` parameter.

#### 3. Validation schemas & DTOs

**File**: `src/lib/schemas/workshop-setup.ts` (new), `src/types.ts`

**Intent**: One zod schema per mutation, defined once and shared between the route handler and the island's error mapping.

**Contract**: Schemas covering workshop details (name required non-empty, phone/address optional), bay (name required, `vehicle_type` optional, `is_active` boolean), service (name required, `duration_min` positive integer), and working-hours row (`opens_at` < `closes_at` unless `is_closed`). `src/types.ts` gains the inferred DTO types plus the shape returned by the read function.

#### 4. Resource routes

**File**: `src/pages/api/workshop.ts`, `src/pages/api/bays/index.ts`, `src/pages/api/bays/[id].ts`, `src/pages/api/services/index.ts`, `src/pages/api/services/[id].ts`, `src/pages/api/working-hours/[weekday].ts` (all new)

**Intent**: Give the settings island a conventional REST surface that S-02–S-06 extend rather than replace.

**Contract**: Uppercase exports only (`PATCH`, `POST`, `PUT` — Astro silently ignores lowercase), `export const prerender = false` on each. Each handler parses the body with its zod schema, returns `400` with field-keyed errors on failure, delegates to `workshop-setup.ts` on success, and returns the updated row as JSON. Verbs: `PATCH /api/workshop`; `POST /api/bays` + `PATCH /api/bays/[id]` (deactivation is a `PATCH` setting `is_active: false`); same shape for services; `PUT /api/working-hours/[weekday]`.

#### 5. Request-scoped Supabase client on `locals`

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Give pages and API routes a client to call the query layer with. Middleware already builds one per request (`src/middleware.ts:7`) and discards it; exposing it avoids a second client per request and keeps the `null` check (config missing) in the one place that already branches on it.

**Contract**: `App.Locals` gains `supabase: TypedSupabaseClient | null` alongside `user` and `profile` (`src/env.d.ts:2-5`). Middleware assigns it immediately after `createClient(...)`, inside the existing `if (supabase)` branch at `src/middleware.ts:12`, and leaves it `null` otherwise. Consumers narrow the null before use; a route reaching a null client returns `503` JSON, matching the existing "Supabase is not configured" posture at `src/pages/api/auth/signup.ts:10-12`.

#### 6. Access control for the new routes

**File**: `src/lib/auth-guard.ts`, `src/middleware.ts`

**Intent**: Bring the new API routes under the same route table that governs pages — never gate a route ad hoc — and make the guard's rejection legible to a `fetch()` caller instead of returning a followed 302 that the island parses as malformed JSON.

**Contract**: `ROUTE_ACCESS` (`src/lib/auth-guard.ts:10`) gains `["/ustawienia", "owner"]`, `["/api/workshop", "owner"]`, `["/api/bays", "owner"]`, `["/api/services", "owner"]`, `["/api/working-hours", "owner"]`. `/api/auth` gets no entry and stays public. In `src/middleware.ts:48-51`, when `guard.type === "redirect"` and `context.url.pathname` starts with `/api/`, return a JSON error `Response` — `401` when `locals.user` is null, `403` when authenticated but wrong role — instead of `context.redirect(...)`. Page requests keep redirecting exactly as they do today.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- pgTAP suite still passes: `npm run db:test`

#### Manual Verification:

- With the dev server running and signed in as the seeded owner, `PATCH /api/workshop` with a valid body returns the updated row; with an empty name it returns `400` and a field-keyed error.
- The same request while signed in as the seeded worker returns `403` JSON — not a redirect, not HTML.
- `/auth/signin` and `/api/auth/signin` still work while signed out (the guard did not over-reach).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: App shell

### Overview

Build the shared chrome every subsequent slice renders inside, replicating the brochure's `AppShell`, and move `/dashboard` into it.

### Changes Required:

#### 1. Logo mark

**File**: `src/components/Logo.astro` (new)

**Intent**: The tire-tread ring that anchors the header lockup.

**Contract**: Port the `Logo3D` SVG from `context/foundation/design-system.md` (Brand identity section) to an Astro component taking a `size` prop.

#### 2. Shell layout

**File**: `src/layouts/AppShell.astro` (new)

**Intent**: One layout owning the dark header and icon nav rail, so no slice reinvents chrome.

**Contract**: Wraps `Layout.astro` (keeping its config banner and `global.css` import). Props: `title`, `active` (nav key), and optional CTA label/href. Header per `wulkanizator-go-brochure/src/App.jsx:250-265` — `bg-gradient-to-r from-slate-900 to-orange-700`, `wulkanizator` white + `go` in `text-orange-400`, `font-black`, divider, page title, optional CTA button, user avatar chip. Nav rail per `App.jsx:268-282` — `w-14 bg-slate-950`, `hidden md:flex`, six items (Dzisiaj, Kalendarz, Klienci, Opony, Cennik, Ustawienia); the active item is `bg-orange-500 text-white`. Icons come from `lucide-react`, imported straight into `AppShell.astro` and rendered **without** a client directive so they compile to static SVG server-side — `@astrojs/react` is already configured (`astro.config.mjs:12`), so no icon dependency is added and no JS ships for the rail. Content slot `flex-1 overflow-y-auto p-4 bg-slate-50`.

**Two deliberate deviations from the brochure**, both because it renders inside a mock device frame: drop the `rounded-[28px]`/`shadow-2xl`/`ring-orange-200` outer frame, and drop the fixed `style={{ height: 680 }}` in favour of `min-h-screen`.

Only Ustawienia and Dzisiaj resolve to real routes. The other four render as disabled buttons (`text-slate-600`, `cursor-not-allowed`, `aria-disabled`) — visible so the shell reads as the brochure's, inert until their slice lands.

#### 3. Dashboard retrofit

**File**: `src/pages/dashboard.astro`

**Intent**: Put the one existing app page inside the new shell so the shell is exercised and the starter's purple-gradient placeholder stops being the app's visual identity.

**Contract**: Swap `Layout` for `AppShell` with `active="Dzisiaj"`. Keep the existing content (greeting, workshop name, role, sign-out) restyled onto brochure card conventions — `rounded-2xl bg-white shadow-sm ring-1 ring-slate-100`. The day plan itself is S-03; this stays a placeholder card.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint` (note `eslint-plugin-astro`'s `no-set-html-directive` is an error — the SVG is inline markup, not `set:html`)
- Production build succeeds: `npm run build`

#### Manual Verification:

- `/dashboard` renders inside the new shell with the correct header lockup and an active "Dzisiaj" nav item.
- At 360px the nav rail is hidden and content remains readable with no horizontal scroll.
- Disabled nav items are visibly inert and not focusable as links.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Settings screen

### Overview

The slice's user-visible payload: `/ustawienia` replicating the brochure's `SettingsScreen`, plus the dashboard nudge that points a new owner at it.

### Changes Required:

#### 1. Page

**File**: `src/pages/ustawienia.astro` (new)

**Intent**: Server-render the configuration and hand it to the island, so the screen paints with real data on first byte (the "czytelne w 2 sekundy" NFR) rather than after a client fetch.

**Contract**: Reads via the Phase 2 query layer using `Astro.locals.supabase` (narrowing the null case to a "Supabase is not configured" message rather than crashing), renders `AppShell` with `active="Ustawienia"` and title "Ustawienia warsztatu", mounts the island with `client:load` passing the configuration as props. No guard logic in the page — `auth-guard.ts` already owns `/ustawienia` (Phase 2).

#### 2. Settings island

**File**: `src/components/settings/WorkshopSettings.tsx` (new), plus the section components it composes

**Intent**: The interactive screen — steppers, inline add, deactivate, hour editing — with optimistic updates and rollback on failure.

**Contract**: Replicates `wulkanizator-go-brochure/src/App.jsx:715-760`: an `xl:grid-cols-[1.2fr_.8fr]` grid; left column "Czasy usług" with per-service `−`/`+` duration steppers and a dashed "Dodaj własną usługę" button; right column stacking "Stanowiska" (list + `bg-slate-900` add button) and "Godziny pracy" (seven weekday rows). Workshop name/phone/address form sits above the grid — not in the brochure, so it follows the same card conventions (`rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100`, `font-black` labels, `rounded-xl` inputs).

Each mutation applies to local state immediately, calls its API route, and reverts that item on non-2xx while surfacing the server's field-keyed error next to the offending input. Class merging goes through `cn()` from `@/lib/utils`. No Next.js directives. Any shared logic lands in `src/components/hooks/`.

Steppers move duration in 5-minute steps with a floor of 5. Deactivation removes the row from the list optimistically (the API sets `is_active: false`).

#### 3. Dashboard nudge

**File**: `src/pages/dashboard.astro`

**Intent**: Give a fresh owner a visible path into setup — without it the only route to `/ustawienia` is the nav rail icon.

**Contract**: An owner-only card linking to `/ustawienia`, shown unconditionally to owners and hidden for workers. No "is it configured yet?" heuristic: inferring that from the workshop name would re-implement `handle_new_user()`'s `split_part(new.email, '@', 1)` rule in the dashboard, so changing the trigger's naming would silently break the nudge — and a one-bay workshop is a perfectly normal steady state, not a signal of incompleteness.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- **Fresh-signup defaults**: sign up a brand-new account, open `/ustawienia`, and confirm the six seeded services, one bay, and Pon–Sob hours are present and editable.
- **Worker lockout**: sign in as the seeded worker (`worker-a@example.com`) and confirm `/ustawienia` redirects to `/dashboard`.
- **Brochure fidelity**: compare side by side against `SettingsScreen` (`wulkanizator-go-brochure/src/App.jsx:715`) at 360px and at desktop width.
- **Failure path**: clear the workshop name and save — confirm an inline field error appears and the optimistic change rolls back rather than failing silently.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Ship

### Overview

Push the schema to production ahead of the merge, and clear the docs this slice invalidates.

### Changes Required:

#### 1. Stale documentation

**File**: `README.md`, `AGENTS.md`

**Intent**: Two statements become actively misleading with this slice. Per `context/foundation/lessons.md:12`, a stale instruction in these files propagates into every downstream slice, since they're the first thing a future agent reads.

**Contract**:
- `README.md:116` — "No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only." Already false since F-01; replace with a pointer to the local database workflow section.
- `README.md` "Trigger kill-switch" — the drop-trigger snippet now also disables default seeding. Add a line stating that workshops created while the trigger is dropped have no profile *and* no default services/bays/hours, so they need manual provisioning after the trigger is restored.
- Add `/ustawienia` to `README.md`'s route table alongside `/dashboard`.
- `AGENTS.md` — extend the "Project Structure" note to mention `src/lib/schemas/` and `src/lib/services/` now that both exist.
- `AGENTS.md` "Hard Rules" — add the API-guard convention this change introduces: protected paths under `/api/` are declared in `src/lib/auth-guard.ts`'s route table like any other route, and middleware answers them with `401`/`403` JSON rather than a redirect. Every S-02–S-06 API route inherits this, and `AGENTS.md:16` currently describes the guard in route-table terms only — leaving the JSON branch unrecorded is exactly the doc-drift `lessons.md:12` warns about.

#### 2. Ship sequence

**Intent**: Merging to `main` triggers a Cloudflare auto-deploy (`context/deployment/deploy-plan.md`, ~93s to live). Deploying a settings page against a production database that lacks `bays`/`services`/`working_hours` breaks the screen; the trigger change is the more dangerous half, since a failure there breaks *signup*.

**Contract**: Execute in this order, no step skipped:

1. Confirm the working tree is clean on `feat/workshop-setup` and all four prior phases are committed.
2. `npm run db:reset && npm run db:test` — full local verification against a from-scratch database.
3. `npx supabase db push` — apply both migrations to production.
4. In the production Supabase dashboard, confirm the three tables exist with RLS enabled, that `handle_new_user()` shows the new body, and that **every pre-existing workshop now has 7 working-hours rows** (the backfill) — `select workshop_id, count(*) from public.working_hours group by 1;`.
5. Sign up a throwaway account against production and confirm it gets its defaults. **If signup fails**, drop the trigger immediately (`drop trigger if exists on_auth_user_created on auth.users;` — README kill-switch) and stop; do not merge.
6. Merge `feat/workshop-setup` to `main` and let CI + the auto-deploy run.
7. After the deploy lands, sign in on production and confirm `/ustawienia` renders with real data.

### Success Criteria:

#### Automated Verification:

- No stale references remain: `grep -rn "No database tables or migrations" README.md` returns nothing
- Full local suite from scratch: `npm run db:reset && npm run db:test`
- Lint, typecheck, and build pass: `npm run lint && npm run typecheck && npm run build`

#### Manual Verification:

- Production database shows all three tables with RLS enabled and the updated trigger function.
- Every pre-existing production workshop has 7 working-hours rows, 1 bay, and 6 services (the backfill landed).
- A throwaway production signup completes and receives its seeded defaults.
- After merge and deploy, `/ustawienia` renders on production for the owner account.

**Implementation Note**: This is the final phase. Confirm the production checks by hand before considering the change complete.

---

## Testing Strategy

### Automated (pgTAP only — see "What We're NOT Doing"):

- Cross-workshop isolation for `bays`, `services`, `working_hours` — owner A sees zero rows of workshop B's configuration.
- Cross-role write denial — worker A's INSERT and UPDATE against all three tables affect zero rows.
- Absent-grant denial — direct DELETE throws `42501`.
- Seeded-shape assertions — a workshop has exactly 6 services, 1 bay, 7 working-hours rows, pinning the trigger against silent regression.

### Manual Testing Steps:

1. Sign up a fresh account; confirm defaults appear on `/ustawienia`.
2. Rename the workshop, add a bay, change a service duration, close Saturday; reload and confirm all four persisted.
3. Deactivate a service; confirm it disappears and stays gone after reload.
4. Clear the workshop name and save; confirm inline error and rollback.
5. Sign in as `worker-a@example.com`; confirm `/ustawienia` redirects and a direct `PATCH /api/workshop` returns `403` JSON.
6. Compare against the brochure's `SettingsScreen` at 360px and desktop.

## Performance Considerations

The settings page issues four reads (workshop, bays, services, hours) in one server round trip before first byte, all indexed on `workshop_id` and all returning single-digit row counts. Nothing here approaches the 2-second NFR budget. Optimistic updates mean no perceived latency on edit.

## Migration Notes

Both migrations are additive — new tables, new nullable columns, a `create or replace` of an existing function, and one idempotent backfill statement. No destructive change; existing workshops keep working.

The trigger only fires at signup, so workshops created before this slice would otherwise start empty. For `bays` and `services` that would merely be inconvenient (the owner can add rows), but `working_hours` has no INSERT grant by design — an old workshop could never acquire hours through the app, and S-02 reads exactly that table. Phase 1's backfill (`select public.seed_workshop_defaults(id) from public.workshops;`) closes this for every existing workshop, including the production account created during F-01's deploy verification. Because `seed_workshop_defaults()` is idempotent, re-running the migration or calling it again is harmless.

Rollback: `wrangler rollback` reverts the app; the schema stays (additive, harmless). If the trigger misbehaves, the README kill-switch drops it without touching existing data.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- Design system + screen mapping: `context/foundation/design-system.md`
- Brochure reference screen: `/Users/tomaszskoczewski/Code/wulkanizator-go-brochure/src/App.jsx:715` (`SettingsScreen`), `:247` (`AppShell`), `:90-97` (service fixture)
- RLS pattern to copy: `supabase/migrations/20260814235519_role_and_workshop_scope.sql:73-102`
- Trigger to extend: `supabase/migrations/20260815000433_handle_new_user.sql:12`
- pgTAP suite to extend: `supabase/tests/rls_workshop_scope.test.sql`
- Route table: `src/lib/auth-guard.ts:10`
- Prior change (F-01): `context/archive/2026-08-15-role-and-workshop-scope/plan.md`
- Binding lessons: `context/foundation/lessons.md:5` (merge = deploy), `:12` (grep docs on symbol change), `:26` (replicate the brochure)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, provisioning & RLS

#### Automated

- [x] 1.1 Migrations apply cleanly from scratch: `npm run db:reset` — e627fb9
- [x] 1.2 pgTAP suite passes with the new assertions: `npm run db:test` — e627fb9
- [x] 1.3 Regenerated types are committed and drift-free: `npm run db:types && git diff --exit-code src/db/database.types.ts` — e627fb9
- [x] 1.4 Type checking passes: `npm run typecheck` — e627fb9
- [x] 1.5 Linting passes: `npm run lint` — e627fb9

#### Manual

- [x] 1.6 Fresh signup succeeds and Studio shows 6 services, 1 bay, 7 working-hours rows — e627fb9

### Phase 2: Service layer, zod validation & API routes

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 pgTAP suite still passes: `npm run db:test`

#### Manual

- [x] 2.5 `PATCH /api/workshop` returns the updated row on valid input and 400 + field errors on empty name
- [x] 2.6 The same request as the seeded worker returns 403 JSON, not a redirect
- [x] 2.7 `/auth/signin` and `/api/auth/signin` still work while signed out

### Phase 3: App shell

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.4 `/dashboard` renders inside the shell with the correct lockup and active nav item
- [ ] 3.5 At 360px the nav rail is hidden and content has no horizontal scroll
- [ ] 3.6 Disabled nav items are visibly inert and not focusable

### Phase 4: Settings screen

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.4 Fresh-signup defaults appear on `/ustawienia` and are editable
- [ ] 4.5 Seeded worker is redirected away from `/ustawienia`
- [ ] 4.6 Screen matches the brochure `SettingsScreen` at 360px and desktop
- [ ] 4.7 Save-failure path shows an inline field error and rolls back

### Phase 5: Ship

#### Automated

- [ ] 5.1 No stale references remain: `grep -rn "No database tables or migrations" README.md` returns nothing
- [ ] 5.2 Full local suite from scratch: `npm run db:reset && npm run db:test`
- [ ] 5.3 Lint, typecheck, and build pass: `npm run lint && npm run typecheck && npm run build`

#### Manual

- [ ] 5.4 Production database shows all three tables with RLS enabled and the updated trigger
- [ ] 5.5 Every pre-existing production workshop has 7 working-hours rows, 1 bay, 6 services
- [ ] 5.6 Throwaway production signup completes and receives seeded defaults
- [ ] 5.7 After merge and deploy, `/ustawienia` renders on production for the owner
