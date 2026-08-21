<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Day Plan View (S-03)

- **Plan**: context/changes/day-plan-view/plan.md
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → **SOUND** after triage (all 9 findings fixed)
- **Findings**: 2 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict (at review) | After triage |
|-----------|---------------------|--------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

5/5 existing paths ✓, 8/8 new paths correctly absent ✓, 3/3 symbols ✓, brief↔plan ✓,
Progress↔Phase contract ✓ (re-verified after edits: 5/5, 12/12, 9/9, 6/6 criteria↔rows).

`docs/reference/contract-surfaces.md` does not exist — contract-surface check skipped.

## Findings

### F1 — Rewriting /dashboard removes the app's only sign-out control

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 → "The day plan page"
- **Detail**: `dashboard.astro:33` is the sole sign-out reachable by a signed-in user — `Topbar.astro:16`'s copy renders only through `Welcome.astro:28` on the unauthenticated landing page, and `AppShell.astro:57-59`'s avatar is a plain `<div>`. The plan deleted the form and then hedged ("if that leaves no way to sign out…") instead of deciding.
- **Fix A ⭐ Recommended**: Keep the form, demote it below the list
  - Strength: Preserves a working capability with no scope creep; the brochure's own shell renders the avatar as a plain div (`App.jsx:262`).
  - Tradeoff: `/ustawienia` and `/wizyty/*` still have no sign-out.
  - Confidence: HIGH — verified every sign-out entry point in the tree.
  - Blind spot: None significant.
- **Fix B**: Move sign-out into AppShell's avatar
  - Strength: Fixes every screen at once.
  - Tradeoff: Edits a shared layout from inside a feature slice; drifts from the brochure.
  - Confidence: MEDIUM — the interaction is undesigned.
  - Blind spot: Whether a POST form nests cleanly in that header flex row.
- **Decision**: FIXED via Fix A — form retained and demoted; new verification step 2.12 added.

### F2 — The closed-day empty state has no data source

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1 → "Day-scoped query"; Phase 2 → page and island
- **Detail**: Three success criteria depend on distinguishing a closed day from an empty one, but `working_hours` appeared once in the entire plan, as an aside inside the island contract. `getDayPlan()` returned `DayPlanEntry[]` only and the page contract passed no such prop, leaving the implementer to invent an unspecified second query.
- **Fix**: Extend `getDayPlan()` to return `{ entries, workingHours }` via the `Promise.all` shape `getWorkshopConfiguration()` already uses (`workshop-setup.ts:19-24`); thread the prop through page and island.
- **Decision**: FIXED.

### F3 — Pure logic and I/O collapsed into one file, contradicting the cited pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 → items 3 and 4 (now 4 and 5)
- **Detail**: The plan put the pure sort/count/filter functions *and* both Supabase queries in `day-plan.ts` while claiming it "mirrors how slot-suggestions.ts sits beneath appointments.ts". The real pattern is two files — `slot-suggestions.ts` carries an explicit no-I/O header at `:1-12`, `appointments.ts` holds every query. AGENTS.md names that pair as the precedent.
- **Fix A ⭐ Recommended**: Pure functions stay in `day-plan.ts`; queries move into the existing `appointments.ts`
  - Strength: Truest mirror; no new I/O module; every appointment query sits beside `suggestSlotsForService` and `bookAppointment`, where S-04 will look.
  - Tradeoff: `appointments.ts` grows past 200 lines.
  - Confidence: HIGH — the split is directly observable in both files.
  - Blind spot: None significant.
- **Fix B**: Separate `day-plan-queries.ts`
  - Strength: Slice stays self-contained.
  - Tradeoff: Third naming convention for service modules.
  - Confidence: MEDIUM — no precedent for the suffix.
  - Blind spot: Where S-04's mutation would belong.
- **Decision**: FIXED via Fix A.

### F4 — Six filter pills against the brochure's five; `cancelled` visibility undecided

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 → "Day plan island"
- **Detail**: The plan specified "five filter pills plus *Wszystkie*" = six. `App.jsx:316` has exactly five and no *Anulowane*. Separately the plan never decided whether cancelled rows appear at all, and its own test case counted them in the *Wizyty* total. Verified `cancelled` is currently unreachable — S-02 writes only `waiting`, S-04's scope stops at `no_show` (`roadmap.md:37`) — so the sixth pill would filter for a state nothing can produce.
- **Fix A ⭐ Recommended**: Exclude `cancelled` from the board entirely
  - Strength: Matches the brochure exactly; removes dead UI; keeps *Wizyty* meaning booked work; mirrors `appointments.ts:88`.
  - Tradeoff: A future cancel feature must revisit this.
  - Confidence: HIGH — verified nothing writes `cancelled`.
  - Blind spot: None significant.
- **Fix B**: Keep the sixth pill, exclude cancelled from the total
  - Strength: Nothing becomes invisible later.
  - Tradeoff: Ships a permanently empty pill.
  - Confidence: MEDIUM.
  - Blind spot: Whether *Wizyty* should mean booked or all rows.
- **Decision**: FIXED via Fix A — query, pure layer, pills, tests and manual step 6 all aligned; `cancelled` keeps its label/classes for S-04 but leaves the filter list.

### F5 — Helper extraction promised but no phase edits its current home

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 → item 1; Phase 4 → item 2
- **Detail**: Phase 1 said `workshop-clock.ts` "becomes its home" for `workshopTodayDateString` (today private at `NewAppointmentForm.tsx:53-56`, 2 references) but no Changes Required entry touched that file. Two divergent copies would ship and `pad2` would be orphaned — the drift `lessons.md:12` records.
- **Fix**: Add `NewAppointmentForm.tsx` as an explicit Phase 1 file contract — delete the local helper and `pad2` if unused, import from `@/lib/workshop-clock`.
- **Decision**: FIXED — added as Phase 1 item 2; subsequent items renumbered and cross-references updated.

### F6 — No 404 page exists, so the detail route's miss path renders a blank page

- **Severity**: ⚠️ WARNING (upgraded from OBSERVATION after verification)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 → "Detail page"
- **Detail**: Returning `new Response(null, { status: 404 })` works on this adapter, but Astro treats a null-bodied 404 as reroutable (`REROUTABLE_STATUS_CODES = [404, 500]`), looks up route `/404`, finds nothing, and emits status 404 with a `null` body. `wrangler.jsonc:11`'s `not_found_handling` does not rescue it — that applies only to the adapter's `env.ASSETS.fetch()` path, which a matched route's frontmatter never reaches. Result: a genuinely blank page with no way back.
- **Fix**: Add a minimal `src/pages/404.astro` inside `AppShell` with a link to `/dashboard`; Astro renders it and preserves the 404 status.
- **Decision**: FIXED — added as Phase 3 item 3; criterion 3.8 now asserts a rendered page and a 404 status, not merely "not an error page".

### F7 — Identical automated criteria across phases don't prove the new tests were written

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All four phases → Automated Verification
- **Detail**: `lint` / `typecheck` / `build` each appeared three times verbatim, `npm test` twice. `npm test` passes today with only `slot-suggestions.test.ts`, so Phase 1's gate would go green even if `day-plan.test.ts` were never written.
- **Fix**: Name the artifact in the criterion.
- **Decision**: FIXED — criteria 1.1 and 3.1 now name the test file that must exist.

### F8 — The join → flat `DayPlanEntry` mapping step is unnamed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 → "Day-scoped query"
- **Detail**: `DayPlanEntry` is flat but a supabase-js nested select returns nested objects, and the generated types surface the joined relations as possibly-null despite all three FKs being `not null`.
- **Fix**: State the mapping step and how it treats the nullable-by-typing relations.
- **Decision**: FIXED — mapping named (via F2's edit) plus explicit guidance to drop and log such a row rather than assert it away, so an impossible-by-schema state degrades to one missing card instead of crashing the north-star screen.

### F9 — The stated reason for string-based sorting is factually wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 → "Pure day-plan logic"
- **Detail**: Raised during triage from verification evidence. The plan claimed the naive strings "sort lexicographically because the format is fixed-width". Probing the live local Postgres shows the wire format is *not* fixed-width — `to_json` on a `timestamp` yields `2026-09-01T09:00:00` (19 chars) but `…T09:00:00.5` (21) and `…T09:00:00.123456` (26) when sub-second values exist, and `starts_at` is `timestamp(6)` with no precision cast (`20260821090000_...sql:41`). The conclusion holds — those shapes do sort correctly — but the reason is false, and a reader could rely on width (`slice(0,19)`) and be wrong.
- **Fix**: Correct the rationale to zero-padded/left-aligned ordering, note fractional seconds are reachable via direct SQL writes, and direct readers to match the time rather than slice by index.
- **Decision**: FIXED.

## Notes carried forward (not findings)

- **`requireRole` has zero test coverage today** — the repo's only test file is `slot-suggestions.test.ts`. Phase 3's new `auth-guard.test.ts` is therefore the first automated protection for the route table, which raises its value above "nice to have".
- **`docs/reference/contract-surfaces.md` is absent** despite CLAUDE.md describing it as the load-bearing-names registry, so the route table is not registered as a contract surface anywhere.
- **`TIMESTAMP_PATTERN` (`workshop-clock.ts:57`) has no `$` anchor.** Harmless today, but it would silently swallow a `+02:00` offset rather than throwing if a column ever became `timestamptz`. Out of scope for S-03; worth a `lessons.md` entry or a future cleanup.
