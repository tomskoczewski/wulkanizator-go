# Cloudflare Workers Integration & First Production Deploy

## Context

`wulkanizator-go` is a solo-dev, 3-week MVP built on the 10x Astro Starter (Astro 6 SSR + React 19 + Supabase Auth + `@astrojs/cloudflare` v13.5.0). The infrastructure decision landed in `context/foundation/infrastructure.md`: **Cloudflare Workers**, ahead of Vercel and Railway. The repo is already wired for Workers — `wrangler.jsonc` has the correct name, `compatibility_date: 2026-05-08`, and both `nodejs_compat` + `disable_nodejs_process_v2` flags (closing the risk called out in the infrastructure doc). What's still missing is (a) a live cloud Supabase project, (b) production secrets on Cloudflare, (c) the first deploy, and (d) Cloudflare-side Git integration for auto-deploy on push to `main`.

Decisions from planning conversation:
- **Runtime**: Cloudflare Workers with Static Assets (Astro 6 dropped Pages Functions support; Workers is the successor path).
- **Supabase**: fresh cloud project (not local, not existing).
- **Auto-deploy**: Cloudflare-side Git integration (Cloudflare pulls from GitHub and builds on its infra; no GHA token needed).
- **Domain**: `workers.dev` subdomain for MVP; custom domain deferred.
- **Plan tier**: default to Free tier for first deploy; upgrade to Paid ($5/mo) is a documented trigger (see Phase 7), not a day-one action.

Intended outcome: a live, auth-working deployment at `https://wulkanizator-go.<subdomain>.workers.dev`, with automatic redeploy on every push to `main` and a verified rollback path.

---

## Prerequisites & Manual Gates

Manual steps only a human can perform. Complete these before Phase 3.

### Accounts

- [x] **Cloudflare account** exists and is accessible at [dash.cloudflare.com](https://dash.cloudflare.com). Note your Workers subdomain (Workers & Pages → Overview → "Your subdomain").
- [x] **Supabase account** exists at [supabase.com/dashboard](https://supabase.com/dashboard).
- [x] **GitHub repo** for `wulkanizator-go` is pushed to origin (needed for Git integration in Phase 6).

### Local toolchain

- [x] **Node 22.14.0** available: `node --version` should print `v22.14.0` (matches `.nvmrc`). If not, `nvm use` from repo root.
- [x] **Dependencies installed**: `npm ci` (or `npm install`). This installs both `wrangler` and `supabase` as local devDependencies — no global install needed.
- [x] Confirm the two CLIs resolve locally: `npx wrangler --version` prints v4.x+, `npx supabase --version` prints v2.x+.

### Cloudflare CLI (`wrangler`) setup

`wrangler` ships as a local devDependency (`package.json` — already installed by `npm ci`). Do NOT install globally.

- [x] **Log in**: `npx wrangler login` — opens a browser to authorize the machine. Grants scopes for Workers/Pages/Secrets on your account. Credentials land in `~/.config/.wrangler/config/default.toml` (macOS/Linux) and persist across sessions.
- [x] **Verify identity**: `npx wrangler whoami` — prints your Cloudflare email and the account IDs your token can act on. Confirmed 2026-08-13: `tomaszskoczewski@gmail.com`, account ID `f5c3e5fa47ca12abc99931a5367f3c4e`. Token scopes include `workers (write)`, `workers_scripts (write)`, `workers_tail (read)`, `secrets_store (write)` — sufficient for Phase 3.
- [x] **Pin the account (only if you have multiple)**: N/A — only one account on this login, wrangler picks it automatically.
- [ ] **Sanity check remote access**: `npx wrangler deployments list --name wulkanizator-go` — expect `No deployments found` (or an empty list) since we haven't deployed yet. An auth error here means Phase 3 will fail — resolve before continuing.
- [ ] **Troubleshooting**:
  - Corporate proxy blocking OAuth? Use `npx wrangler login --browser=false` and paste the URL manually.
  - Wrong account or want to switch identity? `npx wrangler logout` then log in again.
  - CI or non-interactive shells (not needed here since we chose Cloudflare-side Git integration): would use `CLOUDFLARE_API_TOKEN` env var with a scoped API token — out of scope for this plan.

### Supabase CLI (`supabase`) setup

`supabase` ships as a local devDependency. The CLI is only needed for future migrations and admin tasks — the first deploy uses only the anon key (from the dashboard) and does not require the CLI to be logged in. Still, wire it now so it's ready for the first migration.

- [ ] **Log in**: `npx supabase login` — opens a browser, generates a personal access token, writes it to `~/.supabase/access-token`. Alternatively, run `npx supabase login --token <pat>` with a PAT copied from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) for a fully non-interactive flow.
- [ ] **Verify**: `npx supabase projects list` — should print the account's projects (empty if you haven't done Phase 1 yet, populated after).
- [ ] **Defer linking**: `npx supabase link --project-ref <ref>` connects the local `supabase/` folder to the cloud project. Skip until you actually need to push migrations (`supabase/migrations/` is empty for the first deploy). When you do link, the `<ref>` is the string after `https://` and before `.supabase.co` in your project URL.
- [ ] **Troubleshooting**:
  - `Command not found` when running bare `supabase`: expected — always prefix with `npx`. Do not `npm install -g supabase` (the Supabase team explicitly discourages the global npm install on macOS/Linux; use Homebrew or `npx` instead).
  - "Cannot use with the local development stack" errors: the local Supabase stack (`npx supabase start`) is Docker-based and unrelated to the cloud project used here. This plan does not use the local stack.

### Environment files

- [ ] Confirm `.dev.vars` is listed in `.gitignore` (already true — line 30). This file will hold your local Supabase credentials for `wrangler dev` in Phase 2. Never commit it.
- [ ] `.env` is also gitignored (already true) — used only if you ever start the local Supabase stack via `npx supabase start`, not used by `wrangler dev`.

---

## Phase 1 — Cloud Supabase project (manual gate)

- [x] Create a new project in the Supabase dashboard. Region: **Europe (Frankfurt)** — closest to Cloudflare's WAW/FRA edges for the Polish user base.
- [x] Save the **project URL** and **anon public key** (Dashboard → Settings → API). These become `SUPABASE_URL` and `SUPABASE_KEY`.
- [x] Save the **database password** and **service role key** in a password manager (not needed for the app, but required for future admin tasks and migrations).
- [x] **Auth → Email**: "Confirm email" is ON (production-safe). `src/pages/auth/confirm-email.astro` is load-bearing. Default Supabase SMTP is rate-limited — swap for a custom SMTP provider before real onboarding (tracked in Phase 7).
- [x] **Auth → URL Configuration**: Site URL and Redirect URLs set to `https://wulkanizator-go.tomaszskoczewski.workers.dev` (confirmed by user after Phase 3, before Phase 4 walkthrough).
- [ ] **`supabase/migrations/`** currently has no migrations — the starter uses only the built-in `auth.users` table. No DB schema push is required for the first deploy. If application tables are added later, each must enable RLS per `AGENTS.md` hard rule.

---

## Phase 2 — Local sanity check with `wrangler dev`

Reason: `astro dev` runs on Vite/Node; `wrangler dev` runs on the actual `workerd` runtime. Auth cookie flow and any CJS import failure only surface in `workerd`. Doing this before deploy catches the two highest-impact risks from the infrastructure doc (Supabase `Set-Cookie` in the Workers streaming response path, and CJS-only transitive deps).

- [x] Copy env template: `cp .env.example .dev.vars` (`.dev.vars` is already in `.gitignore`).
- [x] Populate `.dev.vars` with the cloud Supabase `SUPABASE_URL` and `SUPABASE_KEY` from Phase 1. Note: key is the new `sb_publishable_...` format, not a JWT.
- [x] Build: `npm run build` — clean, ~7s.
- [x] Start Workers runtime locally: `npx wrangler dev` — booted on localhost:8787.
- [x] Smoke test **against the workerd runtime, not vite dev**:
  - [x] `GET /` renders (200).
  - [x] `POST /api/auth/signup` reaches Supabase (Supabase-rejected `example.com` test email → 302 back to signup with error, proving call path is intact).
  - [x] `GET /dashboard` unauthenticated → 302 to `/auth/signin` (middleware guard works).
  - [ ] Full browser walkthrough (signup → email confirm → signin → cookie set → `/dashboard` 200 → signout) — **deferred to Phase 4 live URL**. Automated tests confirmed the plumbing; the Set-Cookie / session-cookie round-trip risk from the risk register will be validated against production instead.
- [x] Dry-run bundle audit: `npx wrangler deploy --dry-run --outdir=.wrangler-dry` — clean, all ESM, no CJS warnings. 1.94 MiB / 397 KiB gzipped. **Finding**: `@astrojs/cloudflare` adapter auto-injects two bindings into `dist/server/wrangler.json` — `SESSION` (KV namespace, no `id`) and `IMAGES`. Deferred to Phase 3 to observe wrangler's actual behavior on real deploy.

**Edge cases to watch here:**
- If `POST /auth/signin` succeeds but `/dashboard` still redirects → the `Set-Cookie` header is being dropped in the Workers response path (infrastructure.md risk register). Check `src/lib/supabase.ts:17-21` — the `setAll` uses `cookies.set(name, value, options)` on Astro's `AstroCookies`. This is correct, but confirm `context.locals.user` is populated by adding a temporary `console.log` in `src/middleware.ts:13`.
- If any request throws `async iterable body` → the `disable_nodejs_process_v2` flag is not taking effect. Confirm `wrangler.jsonc:6` contains it and that `wrangler` is v4.x+ (currently v4.90.0 per `package.json`).

---

## Phase 3 — First manual deploy

- [x] Authenticate: `npx wrangler login` — done in prereqs.
- [x] Set production secrets (each command prompts once, value is write-only after):
  - [x] `npx wrangler secret put SUPABASE_URL` — piped from `.dev.vars` non-interactively.
  - [x] `npx wrangler secret put SUPABASE_KEY` — piped from `.dev.vars` non-interactively.
- [x] Deploy: `npx wrangler deploy`. **Two findings surfaced:**
  1. `@astrojs/cloudflare` adapter's auto-injected **SESSION KV binding was auto-provisioned by wrangler** (namespace `wulkanizator-go-session`, id `1314c02b746c487d8c4aa87471cb21df`). No manual KV creation needed — the deferred Phase 2 concern resolved itself.
  2. First deploy attempt failed at the very end with `You need to register a workers.dev subdomain`. Cause was that wrangler CLI can't complete the account-level onboarding non-interactively. Resolved via Cloudflare API: `GET /accounts/<id>/workers/subdomain` confirmed subdomain `tomaszskoczewski` was already registered (auto-created from account email); a second `npx wrangler deploy` then succeeded.
- [x] Live URL: **https://wulkanizator-go.tomaszskoczewski.workers.dev**. Version ID: `af7eca1e-ebc3-4ce9-a1b3-26ac93d27de3`.
- [ ] **Return to Phase 1** and set Supabase **Site URL** + **Redirect URLs** to the live URL. Without this, email confirmation and password recovery emails link back to `localhost:4321`.

**Wrangler warnings to acknowledge** (defaults are fine for MVP; make explicit later if desired):
- `workers_dev` not in `wrangler.jsonc` → defaulted to `true` (workers.dev route enabled).
- `preview_urls` not in `wrangler.jsonc` → defaulted to `true` (preview URLs enabled).

---

## Phase 4 — Post-deploy verification

Repeat the Phase 2 smoke tests against the live URL, in parallel with a log tail:

- [x] Terminal 1: `npx wrangler tail --format pretty` — connected 2026-08-13 03:00 UTC.
- [x] Terminal 2 / browser: hit the deployed URL and walked through signin → `/dashboard` → signout.
- [x] Watched the tail: **8 requests, all Ok, zero 5xx, zero `async iterable body`, zero unhandled rejections.**
- [ ] Verify observability is on: Cloudflare dashboard → Workers & Pages → `wulkanizator-go` → Observability → Logs (should be populated). This is enabled via `wrangler.jsonc:12-14`.

**Key production evidence** (from the tail):
- `POST /api/auth/signin` → Ok → redirect to `/`
- `GET /dashboard` → **Ok** (200) ← proves the middleware read `context.locals.user` correctly, which proves the Supabase session cookie round-tripped through the `workerd` streaming response path. This clears the top risk in the risk register.
- `POST /api/auth/signout` → Ok → clean session teardown.

**Edge cases:**
- If sign-up succeeds but the confirmation email never arrives, Supabase's default SMTP is rate-limited and unreliable for real production. This is expected for MVP; for real users, configure a custom SMTP provider in Supabase → Auth → SMTP Settings (SendGrid, Resend, Postmark all work — out of scope for this deploy but flag it).
- If you get `1101 Worker threw exception` with no useful log, add `console.error` in `src/middleware.ts` around the `supabase.auth.getUser()` call and redeploy. `wrangler tail` will show it.

---

## Phase 5 — Rollback drill

Practice this **once, on purpose, on the live deploy** — the first time you need it should not be during an incident.

- [x] List versions: `npx wrangler versions list` — showed 5 versions pre-drill (secret changes + failed first deploy + af7eca1e).
- [x] Made a trivial code change: `src/components/Welcome.astro:35` h1 → "ROLLBACK DRILL — will be reverted". (Plan's example said `src/pages/index.astro` but the h1 actually lives in the `Welcome` component that `index.astro` includes.)
- [x] Deployed drill version `4cb43731-6166-40cb-bef1-ca284c013580`. Verified live URL served "ROLLBACK DRILL".
- [x] Rolled back with `npx wrangler rollback af7eca1e-… --message "rollback drill" --yes` (non-interactive; `--yes` bypasses the "deploy to 100% of traffic?" prompt).
- [x] Verified live URL reverted to "10x Astro Starter". Note: first curl after rollback still showed the drill h1 — brief propagation lag; retries within 10s were clean.
- [x] Re-applied intended state: reverted the local h1 edit, `npm run build`, `npx wrangler deploy`. Clean-latest version is `2f76b6cf-83fc-43c3-aa5b-e6236d102ada`.

**Version trail** (8 total):
1. `d9777547` — worker create
2. `13fe71ef` — SUPABASE_URL secret
3. `b7304220` — SUPABASE_KEY secret
4. `12ae6c9e` — first deploy attempt (failed at subdomain check)
5. `af7eca1e` — first successful deploy
6. `4cb43731` — drill h1
7. `11087ed8` — rollback (re-published af7eca1e)
8. `2f76b6cf` — clean-latest (current)

**Note per infrastructure.md**: rollback reverts the Worker only. If a deploy was paired with a Supabase migration, rolling back the Worker does NOT roll back the DB — coordinate schema rollbacks via `npx supabase migration` separately.

---

## Phase 6 — Wire Cloudflare-side Git integration (auto-deploy on push to `main`)

This is a **one-time dashboard step** and cannot be scripted via `wrangler` — see infrastructure.md unknown-unknowns.

- [x] Cloudflare dashboard → Worker `wulkanizator-go` → Settings → Build → **Connect Git** (existing-Worker flow; the plan's original "Create → Import a repository" instruction creates a NEW Worker, wrong path for us since Phase 3 already created one).
- [x] Connected GitHub account, selected `tomskoczewski/wulkanizator-go` repo.
- [x] Configured build:
  - Build command: `npm run build`
  - Deploy command: `npx wrangler deploy`
  - Root directory: default
  - Production branch: `main`
- [x] Added **build-time env vars** (separate from runtime secrets — needed at `npm run build` time for Astro's `envField` schema): `SUPABASE_URL`, `SUPABASE_KEY`.
- [x] Enabled **Preview deployments** for non-production branches.
- [x] Push a trivial commit to `main` (this commit); Cloudflare-side build completed and produced new version `56d20afd-109a-46f2-adbb-43994f713b38` — **93 seconds** from push to deployed version. Live URL still healthy.

**Edge cases:**
- **Branch mismatch — RESOLVED (2026-08-13)**: local, GitHub default, and CI now all use `main`. Fixes applied: `.github/workflows/ci.yml` (`branches: [master]` → `[main]`), `AGENTS.md`, `README.md`, and this plan file. Must be committed + pushed BEFORE wiring Cloudflare Git integration so Cloudflare's first build finds a working ci.yml on the right branch.
- **Fork PRs**: preview builds do NOT trigger for PRs from external forks (Cloudflare security default). This is fine for a solo project.
- **Preview URL access**: preview URLs are public by default. If that matters, add a Cloudflare Access policy (Zero Trust → Access → Applications). Free tier includes this.

---

## Phase 7 — Documented follow-ups (do NOT execute now)

Tracked here so they aren't lost, but out of scope for this deploy:

- **CPU limit trigger**: if `wrangler tail` shows `Exceeded CPU limit` errors during the day-planner slot computation (peak season, fully-booked calendar), upgrade to the Workers Paid plan ($5/month) and add `"limits": { "cpu_ms": 30 }` to `wrangler.jsonc`. See infrastructure.md risk register row 3.
- **Custom domain**: when ready, add via Cloudflare dashboard → Workers → Settings → Domains & Routes. Requires the domain to be on Cloudflare DNS (or use CNAME setup on external DNS).
- **Rename `package.json.name`** from `"10x-astro-starter"` to `"wulkanizator-go"` — cosmetic, does not affect the Worker name (which is set by `wrangler.jsonc:3`).
- **CI deploy step**: not needed since Cloudflare-side Git integration handles it. If ever migrating to GitHub Actions, add a `deploy` job to `.github/workflows/ci.yml` gated on `push: [main]` with a `CLOUDFLARE_API_TOKEN` secret scoped to Workers-only.
- **Real SMTP for Supabase Auth**: replace the default rate-limited sender before onboarding real users.

---

## Files touched by this plan

- **No code changes** are required in `src/` — the existing adapter, middleware, and Supabase client are correct.
- **No changes** to `wrangler.jsonc` — already has the two fixes called out in infrastructure.md.
- **New files created locally, not committed**: `.dev.vars` (gitignored).
- **New file created remotely**: the Worker itself, on first `wrangler deploy`.

---

## Verification (end-to-end)

The deploy is "done" when all of the below are true:

- [x] `https://wulkanizator-go.tomaszskoczewski.workers.dev` returns 200 for `/`.
- [x] Signin → `/dashboard` (200) → signout all succeeded against the live URL (Phase 4 walkthrough). Signup happened via the Supabase side of the flow; the app-side signup endpoint plumbing was validated in Phase 2 against `wrangler dev`.
- [x] `npx wrangler tail` showed structured request logs and **zero unhandled exceptions** during the smoke walkthrough (8 requests, all Ok).
- [x] `npx wrangler versions list` shows 9 versions (well over the ≥2 gate).
- [x] Push to `main` triggered a Cloudflare-side build that completed with a new deployed version in 93 seconds (under the ~2-minute target).
- [x] Supabase Dashboard → Authentication → Users shows the test user(s) created via the live flow (user confirmed).

If any of the six fails, do not close out; open a corresponding entry in `context/foundation/lessons.md` via `/10x-lesson` so future deploys benefit.
