<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Workshop Setup (S-01)

- **Plan**: `context/changes/workshop-setup/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-15
- **Verdict**: REVISE → **SOUND** after triage (all 5 findings fixed)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

11/11 paths ✓, 4/4 symbols ✓, brief↔plan ✓, Progress 32/32 items ✓ (33 after fixes), no checkbox leakage ✓. `docs/reference/contract-surfaces.md` absent — surface check skipped. Risky claims verified inline against the codebase rather than via sub-agent.

## Findings

### F1 — Existing workshops can never get working hours

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach (data model) ↔ Migration Notes
- **Detail**: The data model gave `working_hours` select+update grants only, justified by "the trigger seeds exactly seven rows and that set never grows". Migration Notes then claimed pre-existing workshops "land on `/ustawienia` with empty lists and add rows manually" — impossible: no INSERT grant, no INSERT policy, and `PUT /api/working-hours/[weekday]` updates a row that doesn't exist. Bays and services survive (they get INSERT); working hours do not. Dev fixtures are unaffected (`db:reset` re-runs the trigger); the affected account is the owner's own **production** account from F-01's deploy verification — exactly the one S-02's slot algorithm reads hours from. The brief listed this as "accepted rather than backfilled", understating "starts empty" vs. "permanently empty".
- **Fix A ⭐ Recommended**: Backfill all three tables in the Phase 1 migration.
  - Strength: One idempotent `INSERT…SELECT` per table; shares one definition of "a provisioned workshop" with the trigger; also fixes empty bays/services.
  - Tradeoff: Catalogue written twice unless factored into a shared function.
  - Confidence: HIGH — additive, deterministic, covered by the planned pgTAP shape assertions.
  - Blind spot: Production row count unverified, but single-digit.
- **Fix B**: INSERT grant + owner policy on `working_hours` plus an "add hours" UI path.
  - Strength: Migration stays purely structural.
  - Tradeoff: Route + UI state existing only for legacy rows; weakens the "exactly 7 rows" invariant.
  - Confidence: MEDIUM.
  - Blind spot: Unclear UI for six missing weekdays.
- **Decision**: FIXED via Fix A — extracted `public.seed_workshop_defaults(p_workshop_id uuid)` (idempotent) called by both `handle_new_user()` and a one-shot backfill; Migration Notes corrected; Phase 5 gained a production verification step (5.5).

### F2 — Where the Supabase client comes from is never specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (query layer, routes), Phase 4 (page)
- **Detail**: Both phases said "the request-scoped client", but `App.Locals` (`src/env.d.ts:2-5`) carries only `user` and `profile`; middleware builds a client at `src/middleware.ts:7` and discards it. `createClient()` returns `SupabaseClient | null` (`src/lib/supabase.ts:7-9`) and the plan never said who handles null. The implementer's guess was structural — exposing `locals.supabase` means editing `src/middleware.ts` and `src/env.d.ts`, neither listed in any phase contract.
- **Fix A ⭐ Recommended**: Add `locals.supabase` in middleware; list both files in Phase 2.
  - Strength: One client per request; null check collapses into middleware's existing branch; `TypedSupabaseClient` (`src/lib/supabase.ts:27`) already exists as the parameter type.
  - Tradeoff: Widens Phase 2 to touch files F-01 just stabilized.
  - Confidence: HIGH — the exported-but-unused type alias suggests this was the intended shape.
  - Blind spot: Null-client UX (friendly page vs. today's silent-anonymous) still open.
- **Fix B**: Each route/page calls `createClient()` itself, as `src/pages/api/auth/signup.ts:9-12` does.
  - Strength: No middleware or env.d.ts change.
  - Tradeoff: Null check repeated in seven files; two clients per request.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — new Phase 2 change #5 covering `src/middleware.ts` + `src/env.d.ts`; service layer now typed on `TypedSupabaseClient`; null client → `503` JSON; Phase 4 page reads `Astro.locals.supabase`.

### F3 — Nav rail icons reference a package that doesn't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Shell layout
- **Detail**: Contract said icons come "from `lucide-react`'s Astro-side equivalents". No such package is installed — `package.json` has `lucide-react` only. The implementer would choose between rendering lucide-react server-side, adding `@lucide/astro`, or inlining SVGs; one option adds a dependency.
- **Fix**: Import lucide-react components directly in `AppShell.astro` with no client directive so they compile to static SVG server-side; `@astrojs/react` is already configured (`astro.config.mjs:12`).
- **Decision**: FIXED.

### F4 — The new API-guard convention isn't documented anywhere

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 (guard change) ↔ Phase 5 (doc cleanup)
- **Detail**: Phase 2 introduces a cross-cutting rule — guarded `/api/` paths return 401/403 JSON instead of redirecting — that every S-02–S-06 route inherits. Phase 5's AGENTS.md edit only added directory notes, leaving `AGENTS.md:16` describing the guard in route-table terms alone. This is the doc-drift `lessons.md:12` warns about, in the file a future agent reads first.
- **Fix**: Extend Phase 5's AGENTS.md contract with a Hard Rule covering the 401/403 JSON behavior.
- **Decision**: FIXED.

### F5 — Dashboard nudge duplicates a database function's naming rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 — Dashboard nudge
- **Detail**: The nudge was to appear "while the workshop still looks untouched (name still matches the trigger's email-local-part default, or only the seeded single bay exists)" — re-implementing `handle_new_user()`'s `split_part(new.email, '@', 1)` in the dashboard, so a later trigger change silently breaks it. It also misfires forever for an owner whose workshop genuinely is named after their email prefix, and one bay is a normal steady state.
- **Fix**: Show owners a plain "Ustawienia warsztatu" card unconditionally.
- **Decision**: FIXED.

## Notes on what passed

- **Lean Execution**: the "What We're NOT Doing" list is specific and no phase contradicts it.
- **End-State Alignment**: every capability in the Desired End State traces to a backing phase.
- **Progress format**: mechanically valid — one item per Success Criteria bullet, no checkbox leakage into phase blocks, headings matched — so `/10x-implement` will parse it.
