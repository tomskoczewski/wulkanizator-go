# User Role and Workshop Scope — Plan Brief

> Full plan: `context/changes/role-and-workshop-scope/plan.md`
> Roadmap item: **F-01** (`context/foundation/roadmap.md:64-75`)

## What & Why

Wulkanizator GO has authentication but no authorization and no domain schema — a user who signs up
gets an `auth.users` row and nothing else. This change establishes the foundation all six remaining
slices inherit: a `profiles` table binding each user to one workshop and one role (owner/worker),
the RLS pattern that scopes every future table, automatic provisioning, and a role-aware route
guard. Its value is mostly preventive: the roadmap names the failure mode at `roadmap.md:74` — get
the scoping contract wrong and every later table needs a follow-up migration re-adding `workshop_id`
and policies. A too-permissive RLS policy also fails **open** and **silently**, leaking customer
phones and plates against the GDPR-baseline NFR.

## Starting Point

Auth is fully wired (Supabase SSR, `src/middleware.ts`, sign-in/up/out routes). Authorization is
entirely absent: `PROTECTED_ROUTES = ["/dashboard"]` is a flat prefix array with no role dimension,
`App.Locals` carries only `user`, and nothing anywhere creates a profile after `signUp()`.
`supabase/migrations/` **does not exist** — this is the project's first migration. `src/types.ts`
doesn't exist either, and there is no test runner. The Supabase CLI and `@astrojs/check` are already
installed but unused; CI runs lint + build only. Production is live on Cloudflare Workers against a
cloud Supabase project with email confirmation ON.

## Desired End State

Signing up automatically creates a workshop and an owner profile; `/dashboard` shows the workshop
name and role. A manually-created worker can sign in but is redirected away from owner-only routes.
Two users in different workshops cannot read each other's rows — proven by an automated pgTAP suite,
not by inspection. Downstream slices add a table by writing four policies that call
`public.current_workshop_id()`, run one script to regenerate types, and get compile-checked queries.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Table boundary | Minimal `workshops` stub (`id`, `name`, `created_at`) + `profiles` | Gives `workshop_id` a real FK so RLS is provably correct before six tables copy it; S-01 extends with bays/hours/services. |
| RLS scope resolution | `STABLE SECURITY DEFINER` helpers `current_workshop_id()` / `current_user_role()` | Bypasses RLS internally, sidestepping the recursion trap when `profiles` policies reference `profiles`; role changes apply instantly. |
| Provisioning | `AFTER INSERT` trigger on `auth.users` | Atomic — an auth user without a profile becomes structurally impossible, and it works with email confirmation ON where a session-based insert would not. |
| Worker onboarding | Manual SQL snippet in Studio | Holds the roadmap's explicit "no user management" boundary; PRD §Non-Goals also rules out the email an invite flow needs. |
| Route guard | Route→role map + one `requireRole()` helper | Matches the roadmap's "one `requireRole()` helper" bar and keeps every access rule auditable in one file rather than fail-open-by-omission per page. |
| Scope on `locals` | Fetch profile per request → `locals.profile` | Always fresh and simple; one indexed lookup is immaterial at low qps, and it's I/O not CPU so it doesn't press the Workers CPU limit. |
| Migration workflow | Local Docker stack for dev, `db push` to cloud | Gives a throwaway DB where a bad policy is caught in seconds; the alternative is iterating RLS against live customer data. |
| DB types | Generated `database.types.ts` + hand-written `src/types.ts` aliases | Makes schema drift a compile error while keeping the `AGENTS.md` convention that entities live in `src/types.ts`. |
| RLS verification | pgTAP via `supabase test db` | Zero new npm dependencies — the installed CLI runs it against the local stack, making isolation a re-runnable gate rather than a one-time manual check. |
| Missing profile | Sign out + log + redirect with an error message | Fails closed without leaving a half-signed-in session: clearing only `locals.profile` would render a signed-in Topbar on the sign-in page and trap the user in a silent loop. |
| User-visible surface | Schema + middleware + a throwaway proof on `/dashboard` | Makes an otherwise invisible change manually verifiable end-to-end; S-03 replaces the markup. |
| CI | Add `astro check`; DB tests stay local; types-drift check in a pre-push hook | Gives CI a type gate it currently lacks; `astro check` cannot detect stale generated types (it checks against the committed file), so that check needs a DB and lives in husky instead. |

## Scope

**In scope:** `workshops` stub + `profiles` + role enum; scoping helper functions; per-operation RLS
policies on both tables; provisioning trigger; two-workshop seed; pgTAP isolation suite; generated
DB types + `src/types.ts` + typed client; route→role map + `requireRole()` + `locals.profile`;
`/dashboard` proof; `typecheck` in CI; docs incl. the worker-creation snippet; production `db push`.

**Out of scope:** worker invites, join codes, role editor, any user-management UI; bays, working
hours, services, pricing (S-01); multi-workshop accounts; installing zod or retrofitting the
existing auth routes; vitest/playwright; a Supabase job in CI; day-plan UI; JWT custom claims.

## Architecture / Approach

Scope resolves **in the database, in one place**. `public.current_workshop_id()` reads `profiles`
for `auth.uid()` as SECURITY DEFINER, so it bypasses RLS and does not recurse when `profiles`' own
policies call it — the exact trap the inline-subquery approach falls into. Every policy here and in
S-01…S-06 becomes a one-liner. Provisioning is a trigger, so there is no window where an auth user
lacks a profile. The app layer adds defense in depth: middleware resolves `locals.profile` once per
request and enforces a declarative route table through `requireRole()`, giving workers a redirect
instead of a mysteriously empty page. Types are generated from the live schema, then narrowed by
hand in `src/types.ts`.

```
signup → auth.users INSERT → trigger → workshops + profiles(owner)
                                              ↓
request → middleware → getUser() → profile+workshop → locals.profile → requireRole(route table)
                                              ↓
                        every query → RLS → current_workshop_id() → profiles
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Local DB loop + schema | Local stack running; first migration with both tables, helpers, RLS policies | Policy ordering and `search_path` on SECURITY DEFINER functions — a mutable path is a privilege-escalation vector |
| 2. Trigger + isolation tests | Provisioning trigger, two-workshop seed, pgTAP suite | The seed must `UPDATE` profiles, not `INSERT` — the trigger already created them |
| 3. Typed data access | Generated `database.types.ts`, `src/types.ts`, typed client | Generated file goes stale if `db:types` isn't re-run after a migration |
| 4. Role-aware guard | Route→role map, `requireRole()`, `locals.profile`, `/dashboard` proof | Three distinct failure states (no client / no profile / wrong role) must each fail closed |
| 5. Ship it | `typecheck` in CI, pre-push drift hook, docs, production `db push` | Ordering: `db push` must precede the merge, because merging to `main` auto-deploys the Worker in ~93s |

**Prerequisites:** Docker + ~7GB RAM for the local Supabase stack; `npx supabase login` and the
production project-ref for Phase 5. No prior change is required — F-01 has no roadmap prerequisites.

**Estimated effort:** ~2–3 after-hours sessions across 5 phases. Phases 1–2 are the bulk (SQL);
3–5 are mechanical.

## Open Risks & Assumptions

- **pgTAP provisioning** — resolved in plan review: the `create extension` statement goes at the top
  of `supabase/seed.sql`, which `db reset` runs but `db push` never ships. Supabase has no
  "test-only migration" directory.
- **Seeding `auth.users` directly** is a well-known but fiddly pattern; rows need `email_confirmed_at`
  set, a bcrypt-hashed password, **and a matching `auth.identities` row** (`provider = 'email'`) or
  the fixture users can't sign in.
- **Merging is deploying** — Cloudflare Git integration is live (`deploy-plan.md:160-173`), so a
  merge to `main` auto-deploys in ~93s. `db push` must land before the merge, or the new middleware
  queries tables production doesn't have yet. Work on a feature branch; see Phase 5 #6.
- **The trigger has no Worker-level rollback** — `wrangler rollback` cannot undo
  `on_auth_user_created`. A failing trigger breaks every production signup; the kill-switch is
  `drop trigger if exists on_auth_user_created on auth.users;`, documented in the README.
- **Pre-existing production accounts** (created before the trigger) will have no profile and will be
  redirected to sign-in. Backfill with the README snippet or delete and re-create.
- **The deploy plan is now stale** — `deploy-plan.md:56` says the local stack is unused and `:72`
  says no migrations exist. Phase 5 corrects both.
- **zod remains uninstalled** despite the `AGENTS.md` mandate. Deliberate here (no new API routes),
  but it stays a real gap for S-01, which will add endpoints.

## Success Criteria (Summary)

- A new signup lands in the app with a workshop and an `owner` role, with no manual step.
- A worker can see the day plan but is redirected away from owner-only routes; two workshops cannot
  see each other's data, and that holds as a re-runnable test rather than a one-time check.
- A downstream slice can add a scoped table by copying four policies and running one script.
