<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Day Plan View (S-03)

- **Plan**: context/changes/day-plan-view/plan.md
- **Scope**: Phase 1–4 of 4 (full plan)
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

## Findings

### F1 — Custom 404 page never renders for a not-found visit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Success Criteria
- **Location**: src/pages/wizyty/[id].astro:14-16
- **Detail**: When `entry` is null (bad id, malformed id, or an id belonging to another workshop — indistinguishable by design, per the plan), the page returns `new Response(null, { status: 404 })` directly from a matched dynamic route. Astro does not substitute the project's custom `src/pages/404.astro` for a `Response` returned from inside a route that *did* match — that substitution only happens for genuinely unmatched paths, or when the page explicitly calls `Astro.rewrite("/404")`. Verified: no middleware or adapter config rescues this (checked `src/middleware.ts`, `astro.config.mjs`, `wrangler.jsonc`). The result is a blank, unstyled white page with a 404 status for the exact case `404.astro` was built to prevent — a stale link or a cross-workshop id, which is the most common way this route is ever hit. Progress item **3.8** ("A random UUID and a malformed id both render the 404 page … not a blank body") is checked `[x]` but does not hold for the matched-route case; only genuinely unmatched paths (e.g. `/wizyty/nowabc`, `/foobar`) get the branded page.
- **Fix**: Replace `return new Response(null, { status: 404 })` with `return Astro.rewrite("/404")`.
  - Strength: One line, converges both not-found paths (unmatched route vs. matched-route-returns-null) on the same branded `404.astro`, and `Astro.rewrite` preserves the 404 status while swapping in the AppShell page.
  - Tradeoff: None significant — same file, same intent, just the correct API for a matched-route 404.
  - Confidence: HIGH — reproduced the blank-page behavior by reading Astro's rewrite/404 substitution rules against this exact code path; no other file relies on the current raw-Response behavior.
  - Blind spot: Not manually re-tested in a running dev server this session (Progress 3.8 was already marked `[x]` under this incorrect assumption — worth re-running the manual check after the fix).
- **Decision**: FIXED — applied `Astro.rewrite("/404")`; `npm run lint` still green.

### F2 — Calendar-invalid `?data=` value crashes the day plan instead of falling back to today

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas/day-plan.ts:6-13, src/pages/dashboard.astro:12
- **Detail**: `DATE_STRING_PATTERN` (`/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/`) checks digit *shape*, not calendar validity — `2026-02-30`, `2026-04-31`, `2026-06-31` etc. all pass. `resolveDayParam`'s own doc comment promises "a malformed … value resolves to the workshop's today rather than erroring," but a calendar-invalid value isn't malformed by this regex, so it passes through unchanged. Postgres then rejects the invalid date at the timestamp cast in `getDayPlan`'s query, `appointmentsResult.error` is set, and `getDayPlan` throws. `dashboard.astro:12` awaits the call with no try/catch, so any authenticated user hitting `/dashboard?data=2026-02-30` gets an unhandled exception (Astro's default error page) on the app's primary landing screen — no privilege escalation, but a self-inflicted crash reachable by URL editing.
- **Fix A ⭐ Recommended**: Make the schema validate real calendar validity, not just digit shape — round-trip the parsed value through `Date.UTC` and compare the components back (the technique `shiftDateString` already uses internally), rejecting on mismatch so `resolveDayParam` falls back to today exactly like a malformed string does.
  - Strength: Fixes the bug at its source; every caller of `resolveDayParam` gets the promised fallback behavior for free, matching the doc comment's actual intent.
  - Tradeoff: A few more lines in a currently one-line regex schema.
  - Confidence: HIGH — `shiftDateString` already proves this round-trip technique works for this exact date format in this codebase.
  - Blind spot: None significant.
- **Fix B**: Wrap the `getDayPlan` call in `dashboard.astro` in a try/catch and fall back to rendering today's plan on any DB error.
  - Strength: Narrower blast-radius fix, contained to one page.
  - Tradeoff: Leaves the schema's contract broken — any other future caller of `resolveDayParam` (e.g. an API route) inherits the same gap.
  - Confidence: MEDIUM — works for this call site but doesn't fix the root cause.
  - Blind spot: Haven't checked whether `resolveDayParam` has other callers today (currently it does not, but Phase 5+ work could add one).
- **Decision**: FIXED via Fix A — added `isCalendarValidDate` round-trip refine to `dayPlanDateSchema`; `npm test`/`typecheck`/`lint` all green.

### F3 — Roadmap S-03 status never flipped to `done`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:36, :138
- **Detail**: Phase 4 item 3's contract explicitly required: "Flip S-03's `- **Status:**` and its `## At a glance` row to `done` — via `/10x-archive`, not by hand." Both are still `in-progress` at HEAD. The outcome line and the sort-order unknown *were* correctly rewritten/struck (verified), but the status flip — and by extension, running `/10x-archive` on this change — was skipped. `change.md`'s frontmatter also still reads `status: implementing`, confirming the change was never archived.
- **Fix**: Run `/10x-archive day-plan-view` to flip the roadmap status and archive the change folder as the plan's own contract specifies.
- **Decision**: PENDING

### F4 — Unplanned eslint rule disable, scoped wider than the one file that needs it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:63-71
- **Detail**: Not mentioned anywhere in the plan's Changes Required. `@typescript-eslint/no-misused-promises` is turned `"off"` inside the `astroConfig` block (`files: ["**/*.astro"]`), disabling it for every Astro page's frontmatter repo-wide. Confirmed necessary in principle: running the rule against `src/pages/wizyty/[id].astro`'s frontmatter throws `Non-null Assertion Failed: Expected node to have a parent` — a real parser crash caused by the file's top-level `return new Response(null, { status: 404 })`, not a false positive. But the fix silently drops a real bug-catching rule from every other `.astro` file's frontmatter (`404.astro`, `dashboard.astro`, `wizyty/nowa.astro`, `[id].astro` itself once F1 is fixed) with no per-file scoping, so future frontmatter misuse of promises anywhere in the codebase will now go undetected.
- **Fix A ⭐ Recommended**: Scope the rule-off to just the one line that trips the parser crash, via an inline `// eslint-disable-next-line @typescript-eslint/no-misused-promises` comment at the specific `return` in `[id].astro` (paired with a short comment explaining the parser crash, moved from the config file).
  - Strength: Every other `.astro` file keeps real misused-promise detection; the workaround is visible exactly where the crash-triggering pattern lives.
  - Tradeoff: If F1's fix (`Astro.rewrite`) removes the top-level `return new Response(...)` pattern entirely, this inline disable — and the config-level one — may become unnecessary; worth re-testing lint after F1 lands before deciding where the disable belongs, if at all.
  - Confidence: MEDIUM — depends on whether `Astro.rewrite("/404")` still trips the same parser bug (untested); if it does, the inline-disable fix still applies, just at a different line.
  - Blind spot: Haven't run the linter against the post-F1 file content.
  - Fix B: Keep the config-level disable as-is, documented as intentional.
  - Strength: Simpler, already working, already has an explanatory comment.
  - Tradeoff: Permanently weakens lint coverage for a whole file category to work around one file's edge case.
  - Confidence: HIGH — current state, known to work.
  - Blind spot: None significant.
- **Decision**: PENDING

### F5 — Detail page doesn't handle "Supabase not configured" like its sibling pages

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/wizyty/[id].astro:7-16
- **Detail**: `dashboard.astro` and `wizyty/nowa.astro` both render a friendly "Supabase nie jest skonfigurowany" placeholder inside `AppShell` when `Astro.locals.supabase` is null (a real local-dev state this codebase explicitly handles). `[id].astro` instead folds that condition into the same `supabase && …` guard that also covers "not found," so an unconfigured Supabase falls through to the bare 404 `Response` rather than the established placeholder.
- **Fix**: Branch on `!supabase` before the not-found check and render the same `AppShell` placeholder the sibling pages use.
- **Decision**: PENDING

