# Design System Foundation Implementation Plan

## Overview

Establish the private `wulkanizator-go-brochure` mockup as the canonical, near-1:1 UI/UX reference for Wulkanizator GO, and wire that reference into the toolkit so every future UI-touching slice (S-01–S-06) picks it up automatically instead of working from memory or inventing its own look. This is a **documentation-only** foundation change: no `src/` code is touched. The actual application of colors, radii, and layout happens per-slice, when each slice's own `/10x-implement` run builds its real screen against the brochure and this reference.

## Current State Analysis

- No prior design/branding docs exist anywhere in this repo or its git history. `src/styles/global.css` is the fully unmodified shadcn "new-york" theme; `src/pages/index.astro` still renders the starter's placeholder.
- The private brochure repo (`github.com/tomskoczewski/wulkanizator-go-brochure`, live preview `wulkanizator-go-brochure.vercel.app`) contains a fully-built React/Tailwind mockup of all 10 core MVP screens plus marketing sections, in one consistent visual language (orange-on-slate, `font-black` typography, `rounded-2xl` cards). It was cloned and read directly (`src/App.jsx`) this session.
- `context/foundation/roadmap.md` already carries `F-02: design-system-foundation` (added this session, reworded to reference-only scope) and, this session, a `- **Brochure reference:**` line was added to each of S-01–S-06 pointing at the exact matching brochure screen and its `App.jsx` line number. S-03's prior "status color palette" Unknown is resolved by pointing at this change's output doc.
- Every brochure screen has a direct, unambiguous match to a roadmap slice, confirmed by reading `App.jsx` section-by-section:
  - `SettingsScreen` (`App.jsx:715`) ↔ S-01 (bays, hours, service durations)
  - `AddVisitScreen` (`App.jsx:402`) + `MobilePreview` (`App.jsx:876`) ↔ S-02
  - `TodayScreen` (`App.jsx:293`) ↔ S-03 (the north star — a direct 1:1 mockup)
  - `VisitDetailScreen`'s status-step block (`App.jsx:478`, ~L503-513) + `StatusPill` (`App.jsx:169`) ↔ S-04
  - `ClientsScreen` (`App.jsx:539`) + `CustomerProfileScreen` (`App.jsx:580`) ↔ S-05
  - `StorageScreen` (`App.jsx:630`) + `StorageIntakeScreen` (`App.jsx:676`) ↔ S-06
  - `WeekScreen` (`App.jsx:359`) and `PricingScreen` (`App.jsx:764`) don't map to any current MVP slice — they correspond to Parked items (weekly view, revenue/forecast) and are worth noting for if those get unparked.
- `context/foundation/lessons.md` (re-read at the start of every `/10x-plan`/`/10x-plan-review`/`/10x-implement` run, per its own header) is the mechanism that makes a reference "picked up automatically" without anyone having to remember to check.

## Desired End State

`context/foundation/design-system.md` exists as the canonical UI/UX reference: it opens with an explicit instruction that the brochure is the near-1:1 source of truth (not just the token summary below it), carries the full screen-mapping table, and a condensed palette/typography/component-convention summary for quick cross-checking. `context/foundation/lessons.md` carries a new rule making consultation of this doc (and the brochure itself) mandatory before any UI-touching phase — so the next time `/10x-plan` or `/10x-implement` runs for S-01–S-06, it surfaces automatically. No application code changes.

**Verification**: a fresh reader of `design-system.md` can identify, for any of S-01–S-06, exactly which brochure screen to open and replicate; `lessons.md`'s new entry reads correctly against the file's existing format.

### Key Discoveries:

- The brochure's `StatusPill` status set (`App.jsx:169-184`) maps exactly onto the PRD's FR-007 / roadmap S-04 status enum (waiting/in-progress/done/no-show/cancelled) — not a coincidence to re-derive later, it's the direct answer to S-03's now-resolved Unknown.
- Every one of the brochure's 10 screens maps to exactly one roadmap slice (or to a Parked item) — there's no ambiguity to leave to a future planner's judgment; the mapping is fully enumerable now.
- Because the brochure repo is private, future `/10x-plan`/`/10x-implement` runs need `gh repo clone tomskoczewski/wulkanizator-go-brochure` (or equivalent authenticated access) to open it directly — `design-system.md` should say this explicitly so a future agent doesn't waste a turn discovering it via a failed `WebFetch`.

## What We're NOT Doing

- Not touching any file under `src/` — no `global.css` token changes, no new components, no landing-page port. All of that is deferred to when each slice actually implements its screen.
- Not porting the brochure's marketing copy/Hero/Problem/Features/CTA sections — those stay out of scope until a landing page is separately prioritized.
- Not adding `docs/reference/contract-surfaces.md` — unrelated gap, out of scope here.
- Not prescribing exact CSS variable values, exact hex codes to hardcode, or exact component APIs — that's solution-design work for each slice's own `/10x-plan`, informed by (not pre-empted by) this reference.

## Implementation Approach

Two phases, both pure documentation: write the reference doc first, then make its consultation mandatory via the lessons mechanism the toolkit already re-reads on every planning/implementation run. `roadmap.md`'s per-slice brochure pointers were already added directly this session (see Current State Analysis) as part of establishing the mapping — Phase 1 below is where that mapping gets its canonical, detailed home.

## Phase 1: Design system reference doc

### Overview

Write `context/foundation/design-system.md` as the single, canonical place that says "the brochure is the reference — here's exactly which screen answers which slice," plus a condensed summary of the palette/typography/component conventions for quick cross-checking.

### Changes Required:

#### 1. Design system reference doc

**File**: `context/foundation/design-system.md`

**Intent**: Give any future `/10x-plan`/`/10x-implement` run for S-01–S-06 an unambiguous pointer to the exact brochure screen to treat as near-1:1 reference, plus enough of a token summary to sanity-check details without re-opening the brochure for every small question.

**Contract**: A new markdown file with:
- Frontmatter: `source_repo: tomskoczewski/wulkanizator-go-brochure` (private), `source_preview: wulkanizator-go-brochure.vercel.app`, `extracted: 2026-08-15`, `status: locked`, `authority: primary UI/UX reference — near-1:1`.
- **How to use this doc** (opening section, load-bearing): states plainly that the brochure's screens are the near-1:1 reference for layout, copy tone, and visual treatment — this doc's token summary is a quick cross-check, not a substitute. Includes the access note: the repo is private, clone with `gh repo clone tomskoczewski/wulkanizator-go-brochure` (or `gh api repos/tomskoczewski/wulkanizator-go-brochure` to confirm access) before relying on `WebFetch`, which 404s on it.
- **Screen-mapping table**: one row per roadmap slice (S-01–S-06), columns: Slice | Brochure screen(s) | `App.jsx` location | What to replicate. Content as enumerated in Current State Analysis above. Include a closing note for `WeekScreen` (`App.jsx:359`) and `PricingScreen` (`App.jsx:764`) as unmapped-but-available if their Parked roadmap items are ever picked back up.
- **Brand identity**: name lockup ("wulkanizator" + orange "go"), and the `Logo3D` SVG markup copied verbatim from `App.jsx:59-78` as a ready-to-use reference snippet (not a component — that's a slice's job when it's actually needed).
- **Color palette summary**: primary = Tailwind `orange-500`/`orange-600` (hover), neutral = Tailwind `slate` scale (50/100 light surfaces, 900/950 dark surfaces). The 5-way status-color mapping table, labeled against the PRD's FR-007 status enum, exactly as documented in the brochure's `StatusPill` (`App.jsx:169-184`).
- **Typography summary**: `font-black` (900) for headings, labels, and KPI/numeric values, matching the PRD NFR "czytelne w 2 sekundy". In-app screens stay dense (`text-xs`/`text-sm` dominant); large display type is reserved for any future marketing surface.
- **Component convention summary**: card = `rounded-2xl`/`rounded-[24px]` + `shadow-sm ring-1 ring-slate-100`; buttons/inputs = `rounded-xl`; pills/badges = `rounded-full`; gradient-text KPI tiles.
- **Non-goals**: marketing copy/landing-page sections are explicitly out of this doc's authority for now — a forward pointer, not a decision to revisit here.

### Success Criteria:

#### Automated Verification:

- File exists: `test -f context/foundation/design-system.md`
- Markdown formatting passes: `npx prettier --check context/foundation/design-system.md`

#### Manual Verification:

- For each of S-01–S-06, the doc's screen-mapping table gives an unambiguous "open this screen" answer without needing to re-derive it
- The "How to use this doc" section reads as a clear instruction, not just a preamble

**Implementation Note**: Pause here for a quick read-through confirmation before proceeding to Phase 2.

---

## Phase 2: Lock the decision into the toolkit's read path

### Overview

Make the reference doc's authority durable and self-enforcing: add a `lessons.md` rule that every future UI-touching plan/implement run re-reads automatically, and do a final consistency check across everything touched this session.

### Changes Required:

#### 1. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: Ensure the brochure-as-reference decision is "picked up" automatically the next time any UI-touching phase is planned or implemented, without relying on anyone remembering to check — this file is explicitly re-read at the start of `/10x-plan`, `/10x-plan-review`, and `/10x-implement` per its own header.

**Contract**: Append one new `##`-level entry after the existing three, following the exact `Context`/`Problem`/`Rule`/`Applies to` structure at `lessons.md:5-24`:
- **Context**: any change that adds or restyles a UI screen (S-01 through S-06 and beyond).
- **Problem**: without a direct pointer, a future slice would work from a lossy token summary or its own judgment, drifting from the actual look the user built and validated in the brochure — the opposite of the "near-1:1 reference" intent.
- **Rule**: before planning or implementing any UI-touching phase, read `context/foundation/design-system.md`'s screen-mapping table, then open the exact corresponding screen(s) in the brochure repo (`tomskoczewski/wulkanizator-go-brochure`, private — clone via `gh repo clone` if not already local) and use them as the near-1:1 reference for layout, structure, and visual treatment. The token summary in `design-system.md` is a quick cross-check, not a substitute for looking at the actual screen.
- **Applies to**: plan, plan-review, implement.

### Success Criteria:

#### Automated Verification:

- `grep -q "design-system-foundation" context/foundation/roadmap.md` — F-02 entry present
- `grep -c "Brochure reference" context/foundation/roadmap.md` returns `6` — one per S-01–S-06

#### Manual Verification:

- Re-read `context/foundation/roadmap.md`'s S-03 Unknown line — confirms it points at `design-system.md` instead of being open
- Re-read the new `lessons.md` entry against the file's existing three entries — confirms format consistency
- Re-read `context/foundation/design-system.md` end to end as a fresh reader — confirms it's usable standalone to answer "which brochure screen do I open for S-04?"

---

## Testing Strategy

### Unit Tests:

- None — no application code.

### Integration Tests:

- None — no application code.

### Manual Testing Steps:

1. Open `context/foundation/design-system.md` cold and, for a slice picked at random (e.g. S-05), confirm the doc gives an unambiguous answer for which brochure screen to open.
2. Open `context/foundation/lessons.md` and confirm the new entry reads consistently with the existing three (same heading level, same four labeled fields).
3. Open `context/foundation/roadmap.md` and confirm all six `Brochure reference` lines are present and each names a real screen/function from `App.jsx`.

## Performance Considerations

Not applicable — documentation only.

## Migration Notes

Not applicable — no data, no existing UI consumers.

## References

- Source: private repo `github.com/tomskoczewski/wulkanizator-go-brochure` (`src/App.jsx`, cloned and read this session), live preview `wulkanizator-go-brochure.vercel.app`.
- Roadmap: `context/foundation/roadmap.md` — `F-02: design-system-foundation`, and the `Brochure reference` line on each of S-01–S-06.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design system reference doc

#### Automated

- [x] 1.1 File exists: `context/foundation/design-system.md`
- [x] 1.2 Prettier check passes on the new file

#### Manual

- [x] 1.3 Screen-mapping table gives an unambiguous answer for every slice S-01–S-06
- [x] 1.4 "How to use this doc" section reads as a clear instruction

### Phase 2: Lock the decision into the toolkit's read path

#### Automated

- [ ] 2.1 F-02 entry present in roadmap.md
- [ ] 2.2 All 6 `Brochure reference` lines present in roadmap.md

#### Manual

- [ ] 2.3 S-03 Unknown line confirmed resolved
- [ ] 2.4 New lessons.md entry format-consistent with existing entries
- [ ] 2.5 design-system.md re-read standalone and confirmed usable
