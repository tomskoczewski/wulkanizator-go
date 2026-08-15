# User Role and Workshop Scope — Implementation Plan

## Overview

Wulkanizator GO has authentication but no authorization and no domain schema. Every user who signs
up gets a row in `auth.users` and nothing else — no workshop, no role, no data boundary.

This change (roadmap **F-01**) establishes the foundation the remaining six slices build on: a
`workshops` stub and a `profiles` table binding each auth user to exactly one workshop and one role
(`owner` / `worker`), a SECURITY DEFINER helper pair that lets every future RLS policy answer
"which workshop is this user in?" in one line, automatic provisioning so an auth user can never
exist without a profile, a typed data-access layer, and a role-aware route guard.

The value is almost entirely in what it prevents. `context/foundation/roadmap.md:74` names the
failure mode precisely: get the scoping contract wrong and every subsequent table needs a follow-up
migration re-adding `workshop_id` and policies. A too-permissive RLS policy also fails **open** and
**silently** — it leaks customer phone numbers and plates (a direct hit on the GDPR-baseline NFR)
without raising an error anywhere.

## Current State Analysis

**Auth is wired; authorization does not exist.**

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`, a flat prefix array with no role
  dimension. The middleware resolves `context.locals.user` (`:13`) and redirects unauthenticated
  users (`:18-22`). There is no concept of role or workshop anywhere in the request path.
- `src/env.d.ts:1-5` — `App.Locals` declares only `user`.
- `src/pages/api/auth/signup.ts:13` — `supabase.auth.signUp()` writes to `auth.users` and redirects
  to `/auth/confirm-email`. **Nothing** creates a profile, workshop, or role.
- `src/lib/supabase.ts:9` — `createServerClient(...)` is called without a `Database` generic, so
  every query returns `any`-shaped data.

**There is no database schema at all.**

- `supabase/migrations/` **does not exist**. `supabase/` contains only `config.toml` and
  `.gitignore`. This change ships the project's first migration and therefore establishes the
  migration convention, not just one table.
- `src/types.ts` does not exist either, despite `AGENTS.md` naming it as the shared entity/DTO home.

**Tooling is present but unused.**

- `supabase` v2.23.4 is a devDependency (`package.json:52`); `npx supabase test db` is available
  (verified against the installed CLI).
- `supabase/config.toml:60-65` — `[db.seed]` is enabled and already points at `./seed.sql`
  (the file does not exist yet).
- `supabase/config.toml:27-35` — local stack on port 54322, Postgres major version 17.
- `@astrojs/check` is installed (`package.json:15`) but there is **no** `typecheck` script.
- **No test runner exists** — no vitest, no playwright, no pgTAP tests.
- `.github/workflows/ci.yml` runs `astro sync` → `npm run lint` → `npm run build`. It never
  typechecks and never touches a database.

**Production is live and cloud-hosted.**

- `context/deployment/deploy-plan.md` Phases 1–3 are complete: a cloud Supabase project exists
  (Frankfurt), secrets are on Cloudflare, and the Worker is deployed. Email confirmation is **ON**
  in production (`deploy-plan.md:70`).
- `deploy-plan.md:56` states the local Docker stack is not used. **This change supersedes that** —
  see Phase 1.

**Not a blocker, but noted:** `zod` is not installed despite `AGENTS.md` mandating it for API input
validation, and the existing auth routes read raw `formData` and cast (`signup.ts:5-7`). This change
adds no new API routes, so it is left alone deliberately — see "What We're NOT Doing".

## Desired End State

A user who signs up gets a workshop and an `owner` profile automatically. Signing in and visiting
`/dashboard` shows their workshop name and role. A `worker`-role user, created manually via a
documented SQL snippet, can sign in and reach `/dashboard` but is redirected away from owner-only
routes. Two users in different workshops cannot read each other's rows — proven by an automated
pgTAP suite, not by inspection. Downstream slices add a table by writing four policies that call
`public.current_workshop_id()`, regenerate types with one npm script, and get compile-time-checked
queries for free.

**How to verify:** `npx supabase db reset` applies from scratch and seeds cleanly;
`npx supabase test db` passes; `npm run typecheck && npm run lint && npm run build` all pass; CI is
green; and the manual browser walkthrough in Phase 4 succeeds against `wrangler dev`.

### Key Discoveries

- `supabase/migrations/` does not exist — this is migration #1 and sets the convention
  (`YYYYMMDDHHmmss_*.sql` per `AGENTS.md`).
- `supabase/config.toml:60-65` already wires `[db.seed]` to `./seed.sql`, so seeding needs config
  changes only if we deviate from that path.
- `src/middleware.ts:7` constructs the Supabase client per request already — adding a profile
  lookup there is a natural extension, not a new integration point.
- `src/lib/supabase.ts:5-8` returns `null` when env vars are missing (a starter affordance surfaced
  by `src/lib/config-status.ts`). The guard must keep handling that `null` — it is not dead code.
- Production has email confirmation ON, so any provisioning that depends on an active session at
  signup time would not fire until after the confirmation click. A DB trigger sidesteps this
  entirely.
- The UI language is Polish (`src/lib/config-status.ts:15`, PRD). User-facing copy added here
  follows suit.

## What We're NOT Doing

- **No worker invite flow, join codes, role editor, or user-management UI.** Workers are created
  with a documented SQL snippet in Supabase Studio. This is the roadmap's explicit "done too much"
  boundary (`roadmap.md:74`), and PRD §Non-Goals rules out the transactional email an invite needs.
- **No workshop setup UI** — no bays, working hours, services, or pricing. `workshops` gets `id`,
  `name`, `created_at` and nothing more. Those columns and tables are S-01's scope.
- **No multi-workshop support.** One profile, one workshop, enforced by a unique constraint on
  `profiles.user_id`. PRD §Non-Goals: one account = one workshop.
- **No zod install and no retrofit of the existing auth routes.** This change adds no API routes.
  Fixing `signin.ts` / `signup.ts` to match the `AGENTS.md` zod rule is real, but it is a separate
  concern and touching it here widens the diff of a security foundation for no benefit.
- **No vitest / playwright.** RLS is proven with pgTAP through the already-installed Supabase CLI.
- **No Supabase job in CI.** Only an `astro check` step is added. DB tests stay local for now.
- **No day-plan UI.** The `/dashboard` change in Phase 4 is a throwaway proof that S-03 replaces.
- **No custom JWT claims / access-token hook.** Rejected in favour of DB-resolved scope.

## Implementation Approach

**Scope resolves in the database, in one place.** A `STABLE SECURITY DEFINER` function
`public.current_workshop_id()` reads `profiles` for `auth.uid()`. Because SECURITY DEFINER bypasses
RLS, it does not recurse when `profiles`' own policies call it — which is exactly the trap the
inline-subquery approach falls into. A sibling `public.current_user_role()` does the same for role.
Every policy in this change and in S-01…S-06 becomes a readable one-liner. At `target_scale: low
qps` the per-check cost is irrelevant; correctness and non-duplication are what matter.

**Provisioning happens in the database too.** An `AFTER INSERT` trigger on `auth.users` creates a
workshop and an owner profile in the same transaction. There is no window in which an auth user
exists without a profile, regardless of which signup path ran or whether email confirmation is on.

**Defense in depth at the app layer.** RLS is the real boundary, but the middleware also resolves
`locals.profile` per request and enforces a declarative route→role map through a single
`requireRole()` helper. A missing profile fails closed. This gives workers a redirect instead of a
mysteriously empty page, and it means a future misauthored policy is not the only thing standing
between a worker and the owner's settings.

**Types are generated, then narrowed by hand.** `database.types.ts` is generated from the live
schema and committed; `src/types.ts` re-exports hand-written `Profile`, `Workshop`, and `UserRole`
aliases derived from it, satisfying the `AGENTS.md` convention while keeping schema drift a compile
error.

**Everything is proven locally before it touches production.** The local Docker stack becomes the
dev loop: `db reset` re-applies migrations from scratch, `seed.sql` builds a two-workshop fixture,
and pgTAP asserts isolation. Only then does `db push` promote the migration to the live project.

## Critical Implementation Details

**The seed must not fight the trigger.** `seed.sql` runs *after* migrations on `db reset`, so
inserting into `auth.users` fires the Phase 2 trigger and a workshop + owner profile already exist by
the time the seed's next statement runs. The seed must therefore `UPDATE` profiles to demote the
second user in a workshop to `worker` and to rename workshops to fixture-friendly names — **not**
`INSERT` into `profiles`, which will hit the unique constraint on `user_id`. Seeded `auth.users`
rows also need `email_confirmed_at` set, or they cannot sign in against a local stack with
confirmations enabled.

**SECURITY DEFINER functions need `set search_path = ''`.** Without it, a mutable search_path makes
the function a privilege-escalation vector. All object references inside must then be
schema-qualified (`public.profiles`, `auth.uid()`). Execute should be granted to `authenticated`
and revoked from `public`/`anon`.

**pgTAP lives in the seed, not in a migration.** `supabase test db` runs the suite against the local
stack, and `create extension if not exists pgtap with schema extensions;` goes at the top of
`supabase/seed.sql` (Phase 2 #2). There is no "test-only migration" directory in Supabase — every
`.sql` under `supabase/migrations/` is shipped by `db push` — so the seed is the only place the
extension can live without leaking pgTAP into production.

**Ordering within the first migration matters.** `workshops` must be created before `profiles`
(FK), and both tables plus their RLS enablement must precede the helper functions' first use in a
policy. Keep the helpers defined before the policies that call them.

**`createClient()` can still return `null`.** `src/lib/supabase.ts:5-8` returns `null` when env vars
are absent. The Phase 4 middleware must treat "no client" and "no profile" as distinct states — the
former is a misconfiguration (already surfaced by `config-status.ts`), the latter is the orphan case
that fails closed.

---

## Phase 1: Local DB loop + schema migration

### Overview

Stand up the local Supabase stack and write the project's first migration: `workshops`, `profiles`,
the role enum, the scoping helper functions, and per-operation RLS policies on both tables.

### Changes Required:

#### 1. First schema migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_role_and_workshop_scope.sql`

**Intent**: Create the two foundation tables, the role type, the scope-resolution helpers, and the
RLS policies that all downstream tables will copy. This file is the reference implementation of the
project's RLS pattern — write it to be read.

**Contract**:
- `public.user_role` enum: `'owner' | 'worker'`.
- `public.workshops` — `id uuid pk default gen_random_uuid()`, `name text not null`,
  `created_at timestamptz not null default now()`. Nothing else; S-01 extends it.
- `public.profiles` — `user_id uuid pk references auth.users(id) on delete cascade`,
  `workshop_id uuid not null references public.workshops(id) on delete cascade`,
  `role public.user_role not null default 'owner'`, `created_at timestamptz not null default now()`.
  The `user_id` primary key is what enforces one-workshop-per-account. Index `workshop_id`.
- `public.current_workshop_id() returns uuid` and `public.current_user_role() returns
  public.user_role` — both `stable security definer set search_path = ''`, selecting from
  `public.profiles where user_id = auth.uid()`. Grant execute to `authenticated`; revoke from
  `public` and `anon`.
- `alter table ... enable row level security` on both tables.
- Policies, per-operation and per-role as `AGENTS.md` requires, all `to authenticated`:
  - `profiles` — SELECT: `workshop_id = public.current_workshop_id()` (a user sees colleagues in
    their own workshop). UPDATE: owner-only, and only within own workshop. No INSERT or DELETE
    policy — provisioning is the trigger's job (Phase 2) and it bypasses RLS.
  - `workshops` — SELECT: `id = public.current_workshop_id()`. UPDATE: owner-only, same predicate.
    No INSERT or DELETE policy for the same reason.

  Note the asymmetry deliberately: absent policies mean *denied*, which is the correct default for
  operations only the trigger should perform.

#### 2. Local-stack workflow scripts

**File**: `package.json`

**Intent**: Make the local DB loop a one-word command so it actually gets run, and add the missing
typecheck entry point.

**Contract**: Add `db:start`, `db:stop`, `db:reset`, `db:test`, `db:types` scripts wrapping the
corresponding `npx supabase` invocations, plus `typecheck` running `astro check`. `db:types` is
wired in Phase 3; define it here so all DB commands land in one commit.

### Success Criteria:

#### Automated Verification:

- Local stack starts: `npm run db:start`
- Migration applies from scratch: `npm run db:reset`
- Linting passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio (`http://localhost:54323`), `workshops` and `profiles` both show RLS enabled
- Executing `select public.current_workshop_id();` as the `anon` role is rejected with
  `permission denied for function current_workshop_id` — confirming the revoke landed. It does
  **not** return null; anon has no execute grant.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Provisioning trigger + isolation tests

### Overview

Guarantee that no auth user can exist without a profile, then prove workshop isolation actually
holds with an automated test suite.

### Changes Required:

#### 1. Provisioning trigger

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_handle_new_user.sql`

**Intent**: Create a workshop and an owner profile atomically whenever a row lands in `auth.users`,
so the orphan state is structurally impossible rather than merely unlikely.

**Contract**: `public.handle_new_user() returns trigger`, `security definer set search_path = ''`,
inserting one `public.workshops` row and one `public.profiles` row (`role = 'owner'`) for
`new.id`, returning `new`. Attached as `on_auth_user_created`, `after insert on auth.users for each
row` — the trigger name is load-bearing: it is what the README kill-switch snippet drops. The default
workshop name should be derivable without user input — deriving it from the email local-part is
fine; S-01 lets the owner rename it.

#### 2. Two-workshop fixture

**File**: `supabase/seed.sql`

**Intent**: Provide the fixture the isolation tests assert against — two independent workshops, one
of which has both an owner and a worker, so both the cross-workshop and the cross-role dimensions
are covered.

**Contract**: Start the file with `create extension if not exists pgtap with schema extensions;` —
`seed.sql` is the right home because it runs on `db reset` but is never shipped by `db push`, so
pgTAP stays out of production. (Supabase has no "test-only migration" directory: every `.sql` under
`supabase/migrations/` is pushed.)

Then insert three rows into `auth.users` with deterministic uuids, `email_confirmed_at`
set, and a bcrypt-hashed password — **plus one matching `auth.identities` row per user**
(`provider = 'email'`, `provider_id` = the user's uuid, `identity_data` a jsonb object carrying
`sub` and `email`). Without the identity row GoTrue's password grant cannot resolve the account and
the fixture users silently fail to sign in — which pgTAP will not catch, since the SQL tests set
`request.jwt.claims` directly and never traverse the auth path. The trigger then produces three workshops and three owner
profiles. Follow with `UPDATE public.profiles` statements to (a) move user 3 into workshop 1 and
demote them to `worker`, and (b) give the workshops stable fixture names — plus a `DELETE` of the
now-unused third workshop. See "Critical Implementation Details": update, never insert, into
`profiles`.

#### 3. RLS isolation suite

**File**: `supabase/tests/rls_workshop_scope.test.sql`

**Intent**: Turn "the policies are correct" from a claim into a check that re-runs. This is the
regression net for every downstream slice that copies the pattern.

**Contract**: pgTAP tests that, for each fixture user (set via `request.jwt.claims` / `set local
role authenticated`), assert:
- owner sees exactly their own workshop row and their own workshop's profiles;
- owner sees **zero** rows from the other workshop's `workshops` and `profiles`;
- worker sees their workshop and its profiles, matching their owner's visible set;
- worker `UPDATE` on `profiles` and on `workshops` affects zero rows / is rejected;
- direct `INSERT` into `profiles` by any authenticated user is rejected;
- `public.current_workshop_id()` returns the expected uuid per user, and `throws_ok(...)` on
  permission denied when called as `anon` (execute is revoked — see Phase 1).

### Success Criteria:

#### Automated Verification:

- Reset applies migrations and seed together: `npm run db:reset`
- Isolation suite passes: `npm run db:test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Signing up a brand-new user through the running app produces exactly one workshop and one owner
  profile (checked in Studio) — confirming the trigger fires on the real signup path, not just the
  seed
- Deliberately loosening one policy (e.g. dropping the `workshop_id` predicate) makes the suite fail
  — confirming the tests actually bite

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Typed data access

### Overview

Wire generated database types into the Supabase client so schema drift becomes a compile error, and
create the `src/types.ts` the rest of the project will import from.

### Changes Required:

#### 1. Generated schema types

**File**: `src/db/database.types.ts`

**Intent**: Commit the generated `Database` type so type checking works in CI without a database.

**Contract**: Output of `npx supabase gen types typescript --local`, committed verbatim. Regenerated
via the `db:types` script after every migration. Add a header comment marking it generated and
naming the script that produces it.

#### 2. Shared entity and DTO types

**File**: `src/types.ts`

**Intent**: Satisfy the `AGENTS.md` convention that entities and DTOs live here, while keeping the
database as the single source of truth.

**Contract**: Export `UserRole`, `Workshop`, `Profile` as aliases derived from the generated
`Database["public"]["Tables"][...]["Row"]` types, plus a `UserProfile` shape (the
`{ workshopId, workshopName, role }` projection the middleware attaches to `locals`). Hand-written
aliases only — no structural re-declaration of columns.

#### 3. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Parameterize the existing client factory with the `Database` generic so every downstream
`.from(...)` call is checked.

**Contract**: `createServerClient<Database>(...)`. The `null` return on missing env vars
(`:5-8`) and the cookie handling (`:10-22`) are unchanged. Export the client's return type for reuse.

#### 4. Typecheck wiring

**File**: `package.json`

**Intent**: Confirm the `typecheck` and `db:types` scripts added in Phase 1 work end-to-end now that
there is something to typecheck.

**Contract**: `db:types` writes to `src/db/database.types.ts`; `typecheck` runs `astro check` and
exits non-zero on error.

### Success Criteria:

#### Automated Verification:

- Types regenerate without diff against the committed file: `npm run db:types`, then
  `git add -N src/db/database.types.ts && git diff --exit-code src/db/database.types.ts`. The
  `add -N` matters on the first run: the file is untracked when Phase 3 creates it, and plain
  `git diff` reports untracked paths as clean no matter what they contain
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A deliberately wrong column name in a scratch `.from("profiles").select("nope")` call is flagged
  by `npm run typecheck` — confirming the generic is actually threaded through

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Role-aware guard

### Overview

Replace the flat `PROTECTED_ROUTES` array with a declarative route→role map enforced by a single
`requireRole()` helper, resolve the caller's profile onto `locals`, fail closed when it is missing,
and prove the whole chain in the browser.

### Changes Required:

#### 1. Locals contract

**File**: `src/env.d.ts`

**Intent**: Make `workshop_id` and `role` available to every page and API route with types.

**Contract**: Extend `App.Locals` with `profile: UserProfile | null` alongside the existing
`user` (`:3`).

#### 2. Route→role map and guard helper

**File**: `src/lib/auth-guard.ts`

**Intent**: Put every access rule for every protected route in one auditable place, and give
downstream slices a one-line way to add theirs.

**Contract**: Export a route table mapping a path prefix to a required access level
(`"any"` for any authenticated user, or a specific `UserRole`), and `requireRole()` — given the
resolved profile and a pathname, it returns either "allow" or the redirect target. Seed the table
with `/dashboard → "any"`, preserving today's behavior (`middleware.ts:4`). Longest-prefix wins, so
a future `/settings` (owner) nested under a broader rule resolves predictably.

**Note for downstream slices**: this table is the extension point. S-01 adds `/settings → "owner"`;
S-04 needs no entry because status changes are worker-accessible under `/dashboard`.

#### 3. Profile resolution and enforcement

**File**: `src/middleware.ts`

**Intent**: Resolve the profile once per request and enforce the route table, failing closed on any
ambiguity.

**Contract**: After `getUser()` (`:10-13`), when a user is present, fetch their profile joined to
the workshop name and attach the `UserProfile` projection to `context.locals.profile`; set `null`
otherwise. Then delegate to `requireRole()` instead of the inline `PROTECTED_ROUTES` check
(`:18-22`). Behavior on the three failure states, all fail-closed:
- no Supabase client (env vars absent) → existing unauthenticated path, unchanged;
- authenticated but **no profile row** → log the anomaly server-side with the user id, then make the
  session state *consistent* rather than half-signed-in: call `supabase.auth.signOut()` (or at
  minimum set `locals.user = null` alongside `locals.profile`) and redirect to
  `/auth/signin?error=<Polish message>`. Clearing only `locals.profile` is not enough —
  `src/components/Topbar.astro:2` reads `Astro.locals.user`, so the sign-in page would render with
  a signed-in header for a user the middleware is treating as anonymous, and re-submitting
  credentials just lands them back in the same state with no explanation (`signin.ts:19` redirects
  to `/`). `src/pages/auth/signin.astro:4` already reads the `error` query param and passes it to
  `SignInForm` as `serverError`, so the message surfaces with no new UI;
- authenticated with a profile but insufficient role → redirect to `/dashboard`.

#### 4. End-to-end proof on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Make the invisible chain (trigger → profile → RLS → locals) visible so the manual gate
has something real to check.

**Contract**: Read `Astro.locals.profile` alongside the existing `user` (`:4`) and render the
workshop name and role next to the email (`:13-16`). Polish copy, matching the project's UI
language. Deliberately throwaway — S-03 replaces this page.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- RLS suite still passes: `npm run db:test`

#### Manual Verification:

- Against `wrangler dev` (not `astro dev` — per `context/foundation/infrastructure.md:76`, the
  `@supabase/ssr` cookie flow differs in the Workers runtime): sign up a fresh user, confirm, sign
  in, and see the workshop name and `owner` role on `/dashboard`
- Sign in as the seeded worker: `/dashboard` renders with role `worker`
- With a temporary owner-only entry added to the route table, the worker is redirected away from it
  and the owner is not
- Manually deleting a profile row in Studio causes that user's next request to redirect to sign-in
  rather than render a page with undefined scope — and the sign-in page shows the Polish error
  message with a **signed-out** Topbar, not a signed-in one

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 5: Ship it

### Overview

Add the typecheck gate to CI, document the conventions and the manual worker-creation path, and
promote the migration to the production Supabase project.

### Changes Required:

#### 1. CI typecheck gate

**File**: `.github/workflows/ci.yml`

**Intent**: Give CI a type gate at all — today it runs lint + build and never typechecks. To be
precise about what this does *not* do: `astro check` validates application code against the
*committed* `database.types.ts`, which is self-consistent by construction, so it cannot detect a
migration that landed without a `db:types` regeneration. Catching that drift needs a database, and
this change deliberately keeps databases out of CI (see "What We're NOT Doing"). The drift check
lives in Phase 3 (`db:types` + `git diff --exit-code`) and in the pre-push hook below.

**Contract**: Insert `npm run typecheck` between the existing `npm run lint` and `npm run build`
steps. It needs the same `SUPABASE_URL` / `SUPABASE_KEY` env the build step already has, since
`astro check` resolves `astro:env/server` imports. No database access, no new secrets.

#### 1b. Pre-push types-drift hook

**File**: `.husky/pre-push`

**Intent**: Put the one check that *can* catch stale generated types somewhere it actually runs,
rather than relying on the implementer remembering `db:types` after each migration.

**Contract**: husky 9.1.7 is already installed (`package.json:47`) and lint-staged is already wired
for pre-commit, so this is one new hook file. It regenerates types and fails the push on a diff. It
must **skip cleanly, not fail**, when the local stack isn't running — Docker being down is not a
reason to block a push. A nudge, not a gate; the gate would be Fix B (Supabase in CI), rejected
here as too slow for a solo 3-week MVP.

#### 2. Convention and workflow docs

**File**: `AGENTS.md`

**Intent**: Register the load-bearing names so future agents follow the pattern instead of inventing
a second one.

**Contract**: Under the existing Supabase/migrations conventions, document: new tables carry
`workshop_id` and scope their policies with `public.current_workshop_id()`; role checks use
`public.current_user_role()`; regenerate types with `npm run db:types` after every migration; route
access is declared in `src/lib/auth-guard.ts`, never ad hoc in a page.

**Also correct the stale references.** Phase 4 deletes `PROTECTED_ROUTES`, but two lines still point
at it: `AGENTS.md:16` ("guards routes listed in `PROTECTED_ROUTES`") and `AGENTS.md:39` ("Redirects
unauthenticated users away from routes listed in `PROTECTED_ROUTES`"). Both must name the
`src/lib/auth-guard.ts` route table instead. This is not cosmetic — AGENTS.md is what a future agent
reads first, so stale guidance here propagates straight into S-01–S-06, which is exactly the failure
mode this change exists to prevent.

#### 3. Worker creation runbook

**File**: `README.md`

**Intent**: The chosen worker path is manual, so the SQL is the product — it needs to be written
down and correct. `README.md:149` also still says "Add paths to the `PROTECTED_ROUTES` array there
to require authentication", which Phase 4 makes false; it must point at `src/lib/auth-guard.ts`.

**Contract**: A short section covering the local DB loop (`db:start` / `db:reset` / `db:test` /
`db:types`) and a copy-pasteable Studio snippet that moves an existing auth user into a given
workshop with `role = 'worker'`. Note that the user must sign up normally first — the trigger makes
them an owner of their own workshop, and the snippet reassigns them.

Also document the **trigger kill-switch**: `drop trigger if exists on_auth_user_created on
auth.users;`. A failing trigger breaks *all* production signups and `wrangler rollback` cannot undo
it (see "Migration Notes"), so the revert has to be written down where an on-call solo dev will find
it under pressure — not derived on the spot.

#### 4. Deploy-plan correction

**File**: `context/deployment/deploy-plan.md`

**Intent**: `:56` currently says the local stack is not used and `:72` says no migrations exist.
Both are false after this change, and a stale runbook is worse than none.

**Contract**: Correct those two statements, and record that `supabase link` + `db push` is now a
required step when migrations change.

#### 5. Production migration push

**File**: (no file — an operational step)

**Intent**: Promote the schema to the live project so the deployed Worker has something to read.

**Contract**: `npx supabase link --project-ref <ref>` then `npx supabase db push`. Per
`deploy-plan.md:88`, migrations do **not** roll back with `wrangler rollback` — so this runs before
the app change is live on production, and the tables are purely additive to a schema that currently
has none, making the push non-destructive.

#### 6. Ship sequence (ordering is load-bearing)

**File**: (no file — an operational step)

**Intent**: Cloudflare Git integration is live (`deploy-plan.md:160-173`): a push to `main` triggers
a build + `npx wrangler deploy` automatically, measured at ~93 seconds push-to-deployed. **Merging
is deploying.** If the Worker goes live before the migration lands, the Phase 4 middleware queries
`profiles` and `workshops` against a production schema that has no tables and — per its own
fail-closed contract — redirects every authenticated user to sign-in. Production breaks.

**Contract**: Implement this change on a feature branch off `main`, never on `main` directly. Ship
in exactly this order:

1. Feature branch pushed; CI green on the pull request (5.3).
2. `npx supabase db push` against the production project (5.4) — schema first, always.
3. Merge the PR to `main`; Cloudflare auto-deploys in ~90s. Confirm the new version id in the
   dashboard before proceeding.
4. Smoke-test against the deployed Worker (5.5, 5.6).

**Note**: preview deploys are enabled for non-production branches (`deploy-plan.md:171`), so a
preview Worker built before step 2 will show the same missing-table behavior. Harmless — no users
reach preview URLs — but expect it rather than debugging it.

### Success Criteria:

#### Automated Verification:

- Full local gate passes: `npm run typecheck && npm run lint && npm run build`
- RLS suite passes: `npm run db:test`
- CI is green on the pull request

#### Manual Verification:

- `npx supabase db push` reports both migrations applied **while the PR is still unmerged**; the
  production Studio shows `workshops` and `profiles` with RLS enabled
- The PR is merged to `main` only after the push above; Cloudflare reports a new deployed version
  (~90s). Sign up a fresh user against the deployed Worker URL and confirm `/dashboard` shows a
  workshop and the `owner` role
- The README worker snippet, run against production, produces a working worker login

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

None. There is no TS test runner and this change deliberately does not add one — the logic worth
testing lives in SQL policies, and that is where the tests go.

### Integration Tests:

`supabase/tests/rls_workshop_scope.test.sql`, run by `npm run db:test` against the local stack over
the two-workshop seed fixture. Covers: cross-workshop read isolation on both tables, worker write
denial, direct-insert denial on `profiles`, and helper-function correctness including the anonymous
case.

### Manual Testing Steps:

1. `npm run db:start && npm run db:reset`, then `npx wrangler dev`.
2. Sign up a new user; confirm the email locally via Inbucket (`http://localhost:54324`).
3. Sign in and verify `/dashboard` shows the auto-created workshop name and role `owner`.
4. In Studio, confirm exactly one `workshops` row and one `profiles` row were created.
5. Sign in as the seeded worker; verify `/dashboard` renders with role `worker`.
6. Add a temporary owner-only route entry; verify the worker is redirected and the owner is not.
7. Delete the worker's profile row in Studio; verify their next request redirects to sign-in.
8. In Studio as workshop A's owner, attempt to select workshop B's profiles; verify zero rows.

## Performance Considerations

The middleware adds one indexed profile lookup per request, joined to the workshop name. At
`target_scale: { users: small, qps: low }` this is immaterial, and it is I/O rather than CPU — so it
does not press against the Workers CPU limit flagged in `context/foundation/infrastructure.md:70`.
Both helper functions are `STABLE`, letting Postgres cache their result within a statement rather
than re-evaluating per row.

The 2-second day-plan NFR is S-03's constraint; this change adds a single round-trip ahead of it.
If that ever proves material, the fix is a short-TTL cache keyed on user id — not JWT claims, which
were rejected here for staleness.

## Migration Notes

Both migrations are purely additive against a schema that currently has no tables, so there is no
existing data to migrate and no destructive step. The trigger only fires on **new** `auth.users`
rows — any account created before it lands will have no profile and, per Phase 4, will be redirected
to sign-in. If such accounts exist in production, run the README snippet to backfill them, or delete
and re-create them.

Rollback is asymmetric and worth stating plainly: `wrangler rollback` reverts the Worker in ~30
seconds (`deploy-plan.md:88`) but leaves the schema in place. For the **tables** that is fine — the
app tolerates them existing without reading them, so rolling back the Worker alone is safe.

For the **trigger** it is not. `public.handle_new_user()` is not app code: it runs inside every
`auth.users` INSERT regardless of which Worker version is deployed. If it raises — a constraint
violation, a search_path slip, a bad default name — `supabase.auth.signUp()` fails with "Database
error saving new user" for every new account, and `wrangler rollback` does nothing about it. The
DB-side revert is one statement, documented in the README runbook (Phase 5 #3):

```sql
drop trigger if exists on_auth_user_created on auth.users;
```

This restores signup immediately and leaves existing workshops and profiles intact; re-create the
trigger once the function is fixed.

## References

- Roadmap item: `context/foundation/roadmap.md:64-75` (F-01)
- PRD: `context/foundation/prd.md` — §Access Control, §Non-Functional Requirements, §Non-Goals
- Deployment runbook: `context/deployment/deploy-plan.md`
- Workers runtime risks: `context/foundation/infrastructure.md:70-80`
- Existing guard to replace: `src/middleware.ts:4-22`
- Client factory to parameterize: `src/lib/supabase.ts:9`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Local DB loop + schema migration

#### Automated

- [x] 1.1 Local stack starts: `npm run db:start` — 3fe65ba
- [x] 1.2 Migration applies from scratch: `npm run db:reset` — 3fe65ba
- [x] 1.3 Linting passes: `npm run lint` — 3fe65ba

#### Manual

- [x] 1.4 Studio shows RLS enabled on `workshops` and `profiles` — 3fe65ba
- [x] 1.5 `select public.current_workshop_id();` as anon is rejected with permission denied — 3fe65ba

### Phase 2: Provisioning trigger + isolation tests

#### Automated

- [x] 2.1 Reset applies migrations and seed together: `npm run db:reset` — 166b8de
- [x] 2.2 Isolation suite passes: `npm run db:test` — 166b8de
- [x] 2.3 Linting passes: `npm run lint` — 166b8de

#### Manual

- [x] 2.4 Real signup produces exactly one workshop and one owner profile — 166b8de
- [x] 2.5 Deliberately loosening a policy makes the suite fail — 166b8de

### Phase 3: Typed data access

#### Automated

- [x] 3.1 Types regenerate with no diff: `npm run db:types` then `git add -N` + `git diff --exit-code src/db/database.types.ts` — b3238b0
- [x] 3.2 Type checking passes: `npm run typecheck` — b3238b0
- [x] 3.3 Linting passes: `npm run lint` — b3238b0
- [x] 3.4 Build passes: `npm run build` — b3238b0

#### Manual

- [x] 3.5 A wrong column name in a scratch query is flagged by `npm run typecheck` — b3238b0

### Phase 4: Role-aware guard

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck` — 98d773e
- [x] 4.2 Linting passes: `npm run lint` — 98d773e
- [x] 4.3 Build passes: `npm run build` — 98d773e
- [x] 4.4 RLS suite still passes: `npm run db:test` — 98d773e

#### Manual

- [x] 4.5 Fresh signup against `wrangler dev` shows workshop name and `owner` on `/dashboard` — 98d773e
- [x] 4.6 Seeded worker signs in and `/dashboard` renders with role `worker` — 98d773e
- [x] 4.7 Temporary owner-only route redirects the worker but not the owner — 98d773e
- [x] 4.8 Deleting a profile row redirects that user to sign-in with an error message and a signed-out Topbar — 98d773e

### Phase 5: Ship it

#### Automated

- [x] 5.1 Full local gate passes: `npm run typecheck && npm run lint && npm run build` — e1a4df2
- [x] 5.2 RLS suite passes: `npm run db:test` — e1a4df2
- [x] 5.3 CI is green on the pull request

#### Manual

- [x] 5.4 `npx supabase db push` applies both migrations pre-merge; production Studio shows RLS enabled
- [x] 5.5 PR merged after the push; new Worker version deployed; fresh signup shows workshop and `owner` role
- [ ] 5.6 README worker snippet produces a working worker login in production
