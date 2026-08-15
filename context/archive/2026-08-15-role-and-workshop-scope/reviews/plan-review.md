<!-- PLAN-REVIEW-REPORT -->
# Plan Review: User Role and Workshop Scope (F-01)

- **Plan**: `context/changes/role-and-workshop-scope/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-15
- **Verdict**: REVISE → **SOUND** after triage (all 9 findings fixed in the plan)
- **Findings**: 3 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict (initial) | After fixes |
|-----------|-------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

8/8 existing paths ✓ · 3/3 claimed absences ✓ (`src/types.ts`, `supabase/migrations/`, `src/db/`) ·
5/5 symbols ✓ (`PROTECTED_ROUTES`, `createClient` null-return, `App.Locals.user`, `[db.seed]
sql_paths`, no `typecheck` script) · brief↔plan ✓ · Progress↔Phase contract ✓ (5 phases, 29 criteria
bullets, 29 matching rows, per-phase aligned 5/5/5/8/6, no stray checkboxes in phase blocks).

`docs/reference/contract-surfaces.md` does not exist in this project — contract-surface check
skipped. `context/foundation/lessons.md` is scaffolded but empty, so no prior rules applied.

## Findings

### F1 — Anon `revoke execute` contradicts the "returns null" assertion

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 contract vs. Phase 1 manual check, Phase 2 pgTAP contract, Progress 1.5
- **Detail**: Contract revokes execute from `public` and `anon`; three verification steps assert the
  function "returns null rather than erroring" for anon. With the revoke, anon gets
  `permission denied`. The dangerous resolution is granting anon execute to make the check pass,
  widening the surface of the function every downstream policy depends on.
- **Fix**: Keep the revoke; restate all three assertions as permission-denied (`throws_ok` in pgTAP).
- **Decision**: FIXED

### F2 — Phase 5 never says how (or when) the Worker deploys — and merging auto-deploys

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 — Changes Required #5, Success Criteria 5.3–5.5
- **Detail**: Cloudflare Git integration is live (`deploy-plan.md:160-173`) — push to `main` builds
  and deploys in ~93s. The plan never mentions it, lists no deploy step, yet asserts a smoke test
  against "the deployed Worker". If the merge precedes `db push`, the new middleware queries
  `profiles`/`workshops` against a schema with no tables and fail-closes every authenticated request
  to sign-in. This session is on `main`, where any push deploys directly.
- **Fix A ⭐ Recommended**: Name the branch and make the push a hard predecessor — feature branch →
  CI green → `db push` → merge (auto-deploy) → smoke test.
  - Strength: Turns an implicit assumption into a checkable step; matches how the project deploys.
  - Tradeoff: Requires branching off `main` before implementation starts.
  - Confidence: HIGH — deploy mechanism verified at `deploy-plan.md:160-173`.
  - Blind spot: Preview deploys on non-production branches hit the same missing tables (harmless).
- **Fix B**: Push the migration before implementation begins.
  - Strength: Removes the ordering constraint entirely.
  - Tradeoff: Ships an untested schema + live trigger to production, inverting the plan's own
    "proven locally first" principle.
  - Confidence: MEDIUM — safe for tables, risky for the trigger (see F3).
  - Blind spot: Production signups start creating workshops under a Worker that can't display them.
- **Decision**: FIXED (via Fix A — new Phase 5 #6 "Ship sequence", plus 5.4/5.5 restated)

### F3 — "Rolling back the Worker alone is safe" is false once the trigger ships

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Migration Notes, Phase 2 #1
- **Detail**: `handle_new_user()` is not app code — it runs inside every `auth.users` INSERT
  regardless of deployed Worker version. If it raises, `signUp()` fails with "Database error saving
  new user" for every new account and `wrangler rollback` does nothing. No down migration, drop
  snippet, or runbook entry existed.
- **Fix**: Document the kill-switch (`drop trigger if exists on_auth_user_created on auth.users;`)
  in the Phase 5 README runbook; scope the Migration Notes "safe" claim to the tables only. Trigger
  name pinned in the Phase 2 contract so the snippet matches.
- **Decision**: FIXED

### F4 — Seeded `auth.users` can't sign in without matching `auth.identities` rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 #2, Progress 4.6, Testing Strategy step 5
- **Detail**: The seed contract required only uuids, `email_confirmed_at`, and a bcrypt password.
  GoTrue's password grant also needs an `auth.identities` row with `provider = 'email'`. pgTAP
  cannot catch this — the SQL tests set `request.jwt.claims` directly and never traverse auth.
- **Fix**: Extend the contract to insert one identity row per user (`provider_id` = user uuid,
  `identity_data` jsonb with `sub` and `email`).
- **Decision**: FIXED

### F5 — pgTAP extension placement unresolved, and one option isn't real

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details, Phase 2 #3
- **Detail**: The plan offered "a test-only migration path or the seed". Supabase has no test-only
  migration directory — every `.sql` under `supabase/migrations/` is pushed by `db push`. The Phase 2
  test-file contract never mentioned the extension at all.
- **Fix**: Commit to `supabase/seed.sql` (already wired at `config.toml:60-65`, never shipped by
  `db push`); delete the non-existent alternative.
- **Decision**: FIXED

### F6 — CI typecheck cannot detect the drift it's introduced to catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 #1
- **Detail**: Stated Intent was "catch stale generated types". `astro check` validates code against
  the committed `database.types.ts`, which is self-consistent by construction — add a migration,
  skip `db:types`, CI stays green. The real check (Phase 3's `db:types` + diff) needs Docker and
  stays local and voluntary.
- **Fix A ⭐ Recommended**: Correct the Intent and move the drift check to a husky pre-push hook.
  - Strength: Preserves the "No Supabase job in CI" boundary; husky 9.1.7 already installed.
  - Tradeoff: A nudge, not a gate — only fires where Docker runs.
  - Confidence: HIGH — mechanism verified (`package.json:47`).
  - Blind spot: Hook must skip cleanly when Docker is down (now specified in the contract).
- **Fix B**: Supabase service container in CI.
  - Strength: A real gate.
  - Tradeoff: Contradicts an explicit scope boundary; minutes per push on a 3-week MVP.
  - Confidence: MEDIUM.
  - Blind spot: Runtime cost against the 93-second deploy loop unmeasured.
- **Decision**: FIXED (via Fix A — Intent rewritten, new Phase 5 #1b pre-push hook)

### F7 — Orphan-profile fail-closed leaves a half-authenticated session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 #3, second failure state
- **Detail**: Clearing `locals.profile` but leaving `locals.user` and the session cookie means
  `src/components/Topbar.astro:2` renders a signed-in header on the sign-in page, and the user loops
  silently (`signin.ts:19` redirects to `/`). Progress 4.8 would pass while the UX is a dead end.
- **Fix**: `signOut()` (or null `locals.user`) before redirecting, and redirect to
  `/auth/signin?error=<Polish message>` — `signin.astro:4` already renders it via `serverError`.
- **Decision**: FIXED

### F8 — `PROTECTED_ROUTES` documented in three places Phase 5 doesn't touch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 #2 and #3
- **Detail**: Phase 4 deletes `PROTECTED_ROUTES`; `README.md:149`, `AGENTS.md:16`, and `AGENTS.md:39`
  still instruct readers to use it. AGENTS.md is what a future agent reads first, so stale guidance
  propagates into S-01–S-06 — the exact failure this change exists to prevent.
- **Fix**: Extend both doc contracts to replace those three references with the
  `src/lib/auth-guard.ts` route table.
- **Decision**: FIXED

### F9 — `git diff --exit-code` passes vacuously on an untracked file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria / Progress 3.1
- **Detail**: `src/db/database.types.ts` is untracked when Phase 3 first creates it, so the diff
  reports clean regardless of content. The check only bites from Phase 4 onward.
- **Fix**: `git add -N src/db/database.types.ts && git diff --exit-code src/db/database.types.ts`.
- **Decision**: FIXED

## Notes

- `plan-brief.md` was synced alongside the plan (4 edits: missing-profile decision, CI decision,
  Phase 5 risk, Open Risks) so the compressed handoff does not contradict the revised contract.
- Progress↔Phase mechanical contract re-verified after all edits: 29 criteria bullets, 29 rows,
  per-phase 5/5/5/8/6, no checkboxes outside `## Progress`.
