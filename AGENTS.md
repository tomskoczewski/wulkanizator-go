# Repository Guidelines

wulkanizator-go is an Astro 6 SSR app with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui deployed to Cloudflare Workers.

## Hard Rules

- All pages are server-rendered (`output: "server"`). API routes must export `const prerender = false`.
- Use Astro components for static content; React only when client interactivity is required.
- Use `cn()` from `@/lib/utils` for all Tailwind class merging — never concatenate class strings manually.
- Never add Next.js directives (`"use client"`, etc.) to React components.
- Every new Supabase table must enable RLS with per-operation, per-role policies. Tables that belong to a workshop carry a `workshop_id` column and scope every policy with `public.current_workshop_id()`; role checks use `public.current_user_role()`. Regenerate `src/db/database.types.ts` with `npm run db:types` after every migration — the pre-push hook (`.husky/pre-push`) catches drift when it does.
- API route handlers must use uppercase exports (`GET`, `POST`) — Astro silently ignores lowercase-named exports.
- Route access rules live in `src/lib/auth-guard.ts`'s route table — never gate a route ad hoc inside a page or API route. Protected `/api/` paths are declared in the same table like any other route; the middleware answers a failed guard on `/api/*` with `401`/`403` JSON (never a redirect), so a `fetch()` caller gets a parseable error instead of followed HTML.
- Appointment and other domain times are naive workshop-local wall-clock (`timestamp`, not `timestamptz`) — `src/lib/workshop-clock.ts` is the only module permitted to convert between an instant and workshop-local parts. Reach for it (or extend it) rather than calling `Intl.DateTimeFormat`/`new Date()` local-field accessors elsewhere; on any naive `Date`, use the `getUTC*` accessors, never `getDate()`/`getHours()`/etc.

## Project Structure

Source lives in `src/`: pages and API routes in `src/pages/`, React hooks in `src/components/hooks/`, shadcn/ui components (new-york variant) in `src/components/ui/`, shared entity and DTO types in `src/types.ts`, services and helpers in `src/lib/` (extracted business logic in `src/lib/services/`, zod validation schemas in `src/lib/schemas/`). Auth middleware at `src/middleware.ts` resolves the current user and workshop-scoped profile on every request and guards routes via the table in `src/lib/auth-guard.ts`. DB migrations in `supabase/migrations/` with `YYYYMMDDHHmmss_*.sql` naming. Path alias: `@/*` → `src/*`.

## Build, Test, and Development Commands

See @README.md for all available scripts.

Unit tests use Vitest (`npm test` / `npm run test:watch`), colocated as `*.test.ts` next to the module under test. Pure business logic in `src/lib/services/` is expected to carry them — see `src/lib/services/slot-suggestions.ts` / `.test.ts` for the pattern. React island components carry colocated `*.test.tsx` tests instead, opted into the `happy-dom` environment per file via a `// @vitest-environment happy-dom` docblock — see `src/components/appointments/DayPlanBoard.test.tsx` and `context/foundation/test-plan.md` §6.4 for the full recipe.

Pre-commit: lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Coding Style & Conventions

TypeScript strict (extends `astro/tsconfigs/strict`). ESLint flat config: `@typescript-eslint/strict`, React compiler plugin, Astro plugin with `no-set-html-directive` as error. See `@eslint.config.js` and `@tsconfig.json`. Install new shadcn/ui components with `npx shadcn@latest add [name]`. API route input must be validated with zod.

## Commit & Pull Request Guidelines

Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`. Gate: lint + test + typecheck + build (`@.github/workflows/ci.yml`) on every push and PR to `main`.

## Security & Configuration

Env setup, secrets, and Supabase local stack: see `@README.md`.

## Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user and their workshop-scoped profile, attaches them to `context.locals.user` / `context.locals.profile`. Delegates route enforcement to `requireRole()` in `src/lib/auth-guard.ts`; a user authenticated but missing a profile row is signed out and redirected (fail-closed), never left half-signed-in.
- `src/lib/auth-guard.ts` — the route table: path prefix → required access level (`"any"` or a specific role). Add new protected routes here, longest-prefix wins.
- Scope helpers (SQL, `security definer`): `public.current_workshop_id()`, `public.current_user_role()` — every RLS policy on a workshop-scoped table calls these.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

## Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies; workshop-scoped tables carry `workshop_id` and use `public.current_workshop_id()` / `public.current_user_role()`. Regenerate types after every migration: `npm run db:types`.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.
- **Route access**: declared in `src/lib/auth-guard.ts`'s route table, never ad hoc in a page or API route.