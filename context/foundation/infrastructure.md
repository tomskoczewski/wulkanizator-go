---
project: wulkanizator-go
researched_at: 2026-08-13
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 SSR + React 19 islands
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The stack is already wired for it: `@astrojs/cloudflare` v13.5.0 targets Workers natively, `wrangler.jsonc` uses the Workers entrypoint pattern (`main: "@astrojs/cloudflare/entrypoints/server"`), and the developer is familiar with the platform. At the expected scale (small user base, low QPS, single-region Poland), the free tier covers the load; the paid Workers plan at $5/month is a no-risk upgrade when needed. Deploying on any other platform requires switching adapters — a medium-effort runtime change with no benefit for this project.

**Immediate action before first deploy**: add `"disable_nodejs_process_v2"` to `compatibility_flags` in `wrangler.jsonc`. The current `compatibility_date: 2026-05-08` is past the `2025-09-15` threshold that silently enables `nodejs_process_v2`, which causes `async iterable body` errors in Astro 6 SSR with middleware.

## Platform Comparison

| Platform               | CLI-first  | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total   |
| ---------------------- | ---------- | ------------------ | ------------------- | ----------------- | ----------------- | ------- |
| **Cloudflare Workers** | ✅ Pass    | ✅ Pass            | ✅ Pass             | ✅ Pass           | ✅ Pass           | **5/5** |
| Vercel                 | ✅ Pass    | ✅ Pass            | ✅ Pass             | ✅ Pass           | ⚠️ Partial        | 4.5/5   |
| Netlify                | ⚠️ Partial | ✅ Pass            | ✅ Pass             | ✅ Pass           | ✅ Pass           | 4.5/5   |
| Railway                | ⚠️ Partial | ✅ Pass            | ✅ Pass             | ✅ Pass           | ✅ Pass           | 4.5/5   |
| Render                 | ⚠️ Partial | ✅ Pass            | ✅ Pass             | ✅ Pass           | ✅ Pass           | 4.5/5   |
| Fly.io                 | ⚠️ Partial | ⚠️ Partial         | ✅ Pass             | ✅ Pass           | ⚠️ Partial        | 3/5     |

Notes per criterion:

- **CLI-first**: Cloudflare's `wrangler` covers deploy (`wrangler deploy`), rollback (`wrangler rollback [VERSION_ID]`), and log tailing (`wrangler tail`). Netlify, Railway, and Render all lack a CLI rollback command — rollback is dashboard or raw API only. Fly.io's rollback requires redeploying a previous image hash via `fly deploy -i`.
- **Managed/Serverless**: Cloudflare Workers, Vercel, Netlify, Railway, and Render are all fully managed — no OS patching, no networking, no TLS. Fly.io sits one level lower (managed VMs, requires a Dockerfile).
- **Agent-readable docs**: All six platforms publish `llms.txt` and/or per-page `.md` endpoints. Cloudflare leads with per-product `llms.txt` files (Workers-specific, Agents-specific, etc.). Railway and Render are close seconds.
- **Stable deploy API**: All platforms pass. Cloudflare additionally offers `wrangler versions list` and gradual traffic shifting (`--x-versions`). Railway's `railway up` is equally deterministic.
- **MCP / Integration**: Cloudflare has 16+ managed MCP servers (GA since April 2025). Netlify's MCP is GA (June 2025). Railway's remote MCP is GA with 40+ tools. Render's MCP is GA (August 2025). Vercel's MCP is public beta as of 2026-08-13. Fly.io's MCP (`fly mcp server`) is experimental.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

The only platform that runs the project's current runtime without any adapter change. `wrangler` is the gold standard for CLI-first ops — deterministic deploy, versioned rollback, live log tailing, and the broadest MCP server suite of any surveyed platform. Free tier handles 100k requests/day. Familiarity with the platform (interview Q3) removes the learning-curve risk. The compatibility flag gap (`disable_nodejs_process_v2`) is a day-one fix, not a platform deficiency.

#### 2. Vercel

Strong alternative if Cloudflare Workers is ever blocked (pricing, vendor lock-in, compliance). `@astrojs/vercel` v11 supports Astro 6 fully. CLI tooling is mature (`vercel deploy`, `vercel rollback`, `vercel logs`). Docs are agent-readable (`llms-full.txt`). The MCP server is in public beta — functional but not GA-stable. Requires swapping the Cloudflare adapter for the Vercel adapter. On the Hobby plan (non-commercial only; Pro at $20/month for commercial projects). ISR search-param gotcha and edge/serverless split are documented footguns for Astro SSR.

#### 3. Railway

Agent-first PaaS with the strongest agent integration story of any non-Cloudflare platform: local MCP (stdio, 40+ tools), remote MCP (OAuth-based, no plaintext tokens), and `railway setup agent` for one-command bootstrap. Predictable $5/month flat rate (no compute-credit surprises). Requires switching to `@astrojs/node` adapter (`output: 'server'`, `mode: 'standalone'`, `host: '0.0.0.0'`). The only real gap: no CLI rollback — rollback is dashboard-only, which blocks fully automated recovery pipelines.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Stale `tech-stack.md` contract**: `deployment_target: cloudflare-pages` is wrong — Astro 6 adapter dropped Pages support. The project's foundational contract has an incorrect field that will mislead any downstream tool reading it.

2. **`disable_nodejs_process_v2` gap is live right now**: `wrangler.jsonc` has `compatibility_date: 2026-05-08` with only `nodejs_compat`. This is past the `2025-09-15` threshold. Astro middleware can throw `async iterable body` errors in production that don't reproduce locally. This is not a hypothetical risk — it's the current state of the repo.

3. **Free tier 10ms CPU limit will bite the scheduling logic**: The slot-suggestion algorithm (scan all appointments across all workstations, find non-overlapping windows) is exactly the kind of O(n) SSR computation that hits this limit on a fully-booked calendar during peak season. On the free tier, this becomes a production error; upgrading to paid ($5/month) raises the limit to 30ms.

4. **ESM-only runtime rejects CJS dependencies at runtime**: Cloudflare Workers cannot `require()`. Any transitive dependency that ships CommonJS-only throws at runtime. The Supabase client is ESM-clean, but date/time and utility libraries are not always. This must be audited with `wrangler deploy --dry-run` before first deploy.

5. **`cloudflare:workers` module imports create migration coupling**: The Astro 6 adapter requires accessing bindings via `cloudflare:workers`. Each direct usage tightens platform lock-in beyond what the adapter abstraction alone imposes.

### Pre-Mortem — How This Could Fail

The team deployed Astro 6 + Supabase on Workers, confident: the stack pointed there already, the developer knew the platform, local dev was clean. Three months later, two things hit simultaneously during spring tire-change season. First: a `wrangler` version bump bumped the effective `compatibility_date` behavior — or the developer added `disable_nodejs_process_v2` to the wrong section of `wrangler.jsonc` (the flag was missing, not misplaced) — and Astro's middleware started throwing `async iterable body` errors on a random subset of edge requests. The error appeared as a 500 with a Workers-internal stack trace, not an Astro stack trace. It was intermittent: some edge nodes processed requests fine, others failed. Reproducing locally was impossible because `wrangler dev` used the full `workerd` binary but with a local binding set. Second: the day-planner view's slot-computation hit the 10ms CPU limit on fully-booked mornings. Both issues surfaced only under production traffic. The middleware fix took four days to find (a single flag in a config file, documented in a third-party migration blog, not the official adapter docs). During those four days, the workshop owner lost confidence in the system at the exact moment it was most needed. The app was abandoned before being given a fair chance.

### Unknown Unknowns

- **Compatibility flag interactions accumulate silently**: With 50+ flags and new ones per compatibility date, each `wrangler` upgrade or `compatibility_date` bump can change runtime behavior. There is no single "what broke for my Astro 6 app" changelog — you must cross-reference the Workers compatibility changelog, the `@astrojs/cloudflare` adapter releases, and the `workerd` release notes. Pin compatibility dates in `wrangler.jsonc` deliberately and test before bumping.

- **Supabase `@supabase/ssr` cookie flow has a non-obvious Workers path**: Cookie mutation (`Set-Cookie` on responses, `Cookie` on requests) flows through the `Response`/`Request` interface differently in Workers than in Node.js. The `astro:middleware` response pipeline may drop `Set-Cookie` headers in certain streaming response paths. Auth sessions must be explicitly tested in the Workers runtime, not just in Vite dev mode.

- **Workers Builds (auto-deploy from GitHub) requires manual dashboard setup**: The tech stack specifies `ci_default_flow: auto-deploy-on-merge`. With Workers (not Pages), the GitHub integration is configured through the Cloudflare dashboard (Workers & Pages > Create > Import from Git), not via `wrangler.jsonc`. This is a one-time manual step that cannot be scripted with `wrangler` alone.

- **`wrangler dev` runs `workerd` locally but binding simulation differs from production**: Local bindings (Supabase env vars from `.dev.vars`, simulated KV) may behave differently than their production counterparts in subtle ways. Bugs that only manifest in production are harder to diagnose when local dev appears clean.

## Operational Story

- **Preview deploys**: Configure Workers Builds via Cloudflare dashboard (Workers & Pages > Create > Import from Git). Preview URLs are auto-generated per branch in the format `https://[HASH].[project-name].workers.dev`. Protect preview URLs from public access with Cloudflare Access (free tier, one-click policy via Zero Trust dashboard). Fork PRs from external contributors do not trigger preview builds by default — this is intentional.

- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in Cloudflare Workers Secrets (encrypted at rest, write-only after set — values cannot be read back). Set via `npx wrangler secret put SUPABASE_URL`. In local dev, use `.dev.vars` file (already in `.gitignore` per the starter). Rotate by running `npx wrangler secret put SUPABASE_KEY` again — the new value overwrites atomically. No dashboard click required.

- **Rollback**: `npx wrangler rollback` (reverts to the previous deployment immediately) or `npx wrangler rollback [VERSION_ID]` for a specific version. List versions with `npx wrangler versions list`. Typical time-to-revert: ~30 seconds. Database migrations (Supabase `supabase/migrations/`) do NOT roll back automatically — if a migration shipped with the bad deploy, coordinate rollback with Supabase migration tools separately.

- **Approval**: Human-required actions: deleting the Worker, rotating Supabase database passwords, changing custom domain DNS, any billing change. Agent may run unattended: `wrangler deploy`, `wrangler rollback`, `wrangler tail`, `wrangler secret put` (to rotate app-level secrets), `wrangler versions list`.

- **Logs**: `npx wrangler tail` — live-streams all requests and console output to the terminal. `npx wrangler tail --format json` for structured JSON. Through MCP: the `cloudflare_workers_observability` MCP server (GA) exposes logs and metrics as structured tool calls without parsing CLI output.

- **Paused-backend outage**: the Supabase free tier pauses a project after roughly a week without
  activity, and a paused project stops answering on its API hostname entirely. The Worker's
  subrequest then fails at the origin, which surfaces in `wrangler tail` as
  `AuthRetryableFetchError` with **status 530** — not as an application error, and not with any
  message of its own (Cloudflare's own log view shows only a `supabase-js` stack, which is why the
  530 is the signal worth grepping for). The site keeps _looking_ healthy: anonymous pages need no
  network call, so `/` still answers 302 to `/auth/signin` and the form renders 200. Only requests
  carrying a session, and sign-in itself, fail. Confirm with `npx supabase projects list`
  (`"status":"INACTIVE"`) and by curling `https://<ref>.supabase.co/auth/v1/health`, which returns
  no response at all rather than an HTTP error. Clear it from the Supabase dashboard's _Restore
  project_ — the CLI has no restore subcommand (`list`, `create`, `api-keys`, `delete` only). The
  project ref, URL and keys survive the pause, so no secret rotation and no redeploy are needed;
  verify by signing in once. Observed in production 2026-09-11. **Runbook: `README.md` §Paused
  Supabase project.**

## Risk Register

| Risk                                                                                                                        | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disable_nodejs_process_v2` missing → middleware errors in production                                                       | Unknown unknowns                    | H          | H      | Add `"disable_nodejs_process_v2"` to `compatibility_flags` in `wrangler.jsonc` before first deploy.                                                                                                                                                           |
| `tech-stack.md` says `cloudflare-pages` (dropped in Astro 6)                                                                | Research finding                    | H          | M      | Update `tech-stack.md` `deployment_target` field to `cloudflare-workers`.                                                                                                                                                                                     |
| Free tier 10ms CPU limit hit during peak scheduling computation                                                             | Devil's advocate                    | M          | H      | Upgrade to paid Workers plan ($5/month) before first real-traffic deploy; set `cpu_ms: 30` in `wrangler.jsonc`.                                                                                                                                               |
| CJS-only npm dependency throws at Workers runtime                                                                           | Devil's advocate                    | M          | H      | Run `npx wrangler deploy --dry-run` and inspect the bundle; audit date/time and utility packages for ESM support.                                                                                                                                             |
| Supabase `Set-Cookie` dropped in Workers streaming response path                                                            | Unknown unknowns                    | M          | H      | Test login → dashboard → session persistence flow explicitly with `wrangler dev` (not `astro dev`) before launch.                                                                                                                                             |
| Workers Builds GitHub integration requires manual dashboard setup                                                           | Unknown unknowns                    | H          | L      | One-time manual step: configure via Cloudflare dashboard before expecting auto-deploy on merge.                                                                                                                                                               |
| Compatibility date bump breaking middleware silently                                                                        | Pre-mortem                          | M          | H      | Pin `compatibility_date` deliberately; bump only after testing in a staging deployment; follow `@astrojs/cloudflare` adapter changelog.                                                                                                                       |
| Platform coupling through `cloudflare:workers` direct imports                                                               | Devil's advocate                    | L          | M      | Minimize direct `cloudflare:workers` usage; access bindings through Astro locals where the adapter provides an abstraction.                                                                                                                                   |
| Wrangler local dev not reproducing production bugs                                                                          | Unknown unknowns                    | M          | M      | Use `wrangler dev` (not `astro dev`) for any test involving auth, cookies, or binding-dependent code paths.                                                                                                                                                   |
| Supabase free-tier project pauses after ~1 week of inactivity → every authenticated path dies while the site still looks up | Observed in production (2026-09-11) | H          | H      | Keep the project warm (any weekly activity resets the clock) or move it to a paid tier, which does not pause. When it happens: _Restore project_ in the Supabase dashboard — no redeploy. Signature in `wrangler tail`: `AuthRetryableFetchError` status 530. |

## Getting Started

The project already has `@astrojs/cloudflare` v13.5.0 and `wrangler.jsonc` configured for Workers. The steps below close the gaps before first deploy.

1. **Fix `wrangler.jsonc` — two changes required**:

   ```jsonc
   {
     "name": "wulkanizator-go", // rename from "10x-astro-starter"
     "compatibility_flags": ["nodejs_compat", "disable_nodejs_process_v2"], // add the second flag
     // ... rest unchanged
   }
   ```

2. **Authenticate with Cloudflare**:

   ```bash
   npx wrangler login
   ```

3. **Set production secrets**:

   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

4. **Build and deploy**:

   ```bash
   npm run build
   npx wrangler deploy
   ```

   First deploy creates the Worker at `https://wulkanizator-go.[your-subdomain].workers.dev`.

5. **Verify and tail logs**:

   ```bash
   npx wrangler tail
   ```

   Open the Workers URL in a browser, sign up, sign in, and watch the log stream for any `async iterable body` errors (would confirm the flag gap) or auth cookie failures.

6. **Wire auto-deploy from GitHub** (manual step): in the Cloudflare dashboard, go to Workers & Pages > Create > Import from Git, connect the `wulkanizator-go` repository, and configure the production branch. This cannot be scripted via `wrangler` alone.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow file)
- Production-scale architecture (multi-region, HA, DR)
