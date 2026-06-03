---
bootstrapped_at: 2026-06-03T02:05:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: wulkanizator-go
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: wulkanizator-go
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

Solo developer building a tire workshop day-planner (Wulkanizator GO) as a web app with a 3-week after-hours timeline. Auth (email + password login with owner/worker roles) is the only technology-forcing feature from the PRD. The 10x Astro Starter is the recommended default for (web-app, js) and ships auth + PostgreSQL database + edge deploy via Supabase and Cloudflare Pages out of the box, eliminating the need to wire those pieces manually under a tight timeline. All four agent-friendly gates pass (typed TypeScript with Zod schemas, convention-based file routing, popular in training data, well-documented). CI runs on GitHub Actions with auto-deploy on merge to Cloudflare Pages.

## Pre-scaffold verification

| Signal        | Value                                                  | Severity | Notes                                                    |
| ------------- | ------------------------------------------------------ | -------- | -------------------------------------------------------- |
| npm package   | not run                                                | —        | cmd_template uses git clone; no npm CLI package to check |
| GitHub repo   | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url                                       |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 17
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold, .vscode.scaffold/
**.gitignore handling**: append-merged (added `.dev.vars` pattern from starter)
**.bootstrap-scaffold cleanup**: deleted
**.bootstrap-scaffold/.git cleanup**: deleted before move-up (upstream starter history removed)

Notes:
- Empty cwd directories (`src/`, `public/`, `supabase/`, `.husky/`, `.github/`) were replaced by scaffold copies (no user data to preserve).
- Orphaned `node_modules/` (no matching `package.json` in cwd) was replaced by scaffold's freshly-installed copy.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### HIGH findings

- **devalue** v5.6.3–5.8.0 — DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p, CVSS 7.5). Transitive dependency. Fix available.

#### MODERATE findings

- **@astrojs/check** (direct) — via @astrojs/language-server → volar-service-yaml → yaml-language-server → yaml. Fix: downgrade to v0.9.2 (semver major).
- **@astrojs/language-server** — via volar-service-yaml. Transitive.
- **@cloudflare/vite-plugin** — via miniflare, wrangler, ws. Transitive.
- **miniflare** — via ws (GHSA-58qx-3vcg-4xpx, uninitialized memory disclosure, CVSS 4.4). Transitive.
- **wrangler** (direct) — via miniflare → ws. Fix available.
- **ws** v8.0.0–8.20.0 — Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, CVSS 4.4). Transitive.
- **volar-service-yaml** — via yaml-language-server. Transitive.
- **yaml** v2.0.0–2.8.2 — Stack overflow via deeply nested YAML collections (GHSA-48c2-rrv3-qjmp, CVSS 4.3). Transitive.
- **yaml-language-server** — via yaml. Transitive.

## Hints recorded but not acted on

| Hint                    | Value             |
| ----------------------- | ----------------- |
| bootstrapper_confidence | first-class       |
| quality_override        | false             |
| path_taken              | standard          |
| self_check_answers      | null              |
| team_size               | solo              |
| deployment_target       | cloudflare-pages  |
| ci_provider             | github-actions    |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true              |
| has_payments            | false             |
| has_realtime            | false             |
| has_ai                  | false             |
| has_background_jobs     | false             |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
- Copy `.env.example` to `.env` and fill in your Supabase credentials.
- Run `npm run dev` to start the dev server.
