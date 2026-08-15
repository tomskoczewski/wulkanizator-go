# Design System Foundation — Plan Brief

> Full plan: `context/changes/design-system-foundation/plan.md`

## What & Why

The user built a private brochure repo (`wulkanizator-go-brochure`) that mocks up all 10 core MVP screens in a specific visual language — orange-on-slate, weight-driven typography, rounded cards. It predates the shape-notes/PRD/roadmap and never made it into any foundation doc. The user wants it treated as the **near-1:1 reference** for UI implementation once it starts — not just a vague style inspiration, and not something anyone has to remember to check. This change makes that automatic: it doesn't implement any UI itself.

## Starting Point

`src/styles/global.css` is the fully unmodified shadcn "new-york" theme. No UI implementation has started. No design/branding doc exists anywhere in the repo or its git history. `context/foundation/roadmap.md` already has an `F-02` foundation entry and per-slice `Brochure reference` pointers added this session.

## Desired End State

`context/foundation/design-system.md` exists as the canonical reference: an explicit screen-mapping table (which brochure screen answers which roadmap slice, with `App.jsx` line numbers) plus a condensed palette/typography/component summary. `context/foundation/lessons.md` carries a rule that `/10x-plan` and `/10x-implement` re-read automatically — so the next time any UI slice is planned, the brochure surfaces without anyone asking for it. **No application code changes.**

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | Documentation and reference-wiring only, zero `src/` changes | User was explicit mid-review: no implementation now, this change only has to make the brochure "get picked up" later |
| Reference mechanism | `design-system.md`'s screen-mapping table + a `lessons.md` rule (re-read every `/10x-plan`/`/10x-implement` run) | `lessons.md`'s own header says it's re-read at the start of every planning/implementation run — the one existing mechanism that guarantees automatic pickup |
| Mapping granularity | One explicit brochure-screen pointer per roadmap slice (S-01–S-06), added directly to `roadmap.md` | Every brochure screen has an unambiguous 1:1 match to a slice — no reason to leave that lookup to a future planner |
| Fidelity instruction | Doc explicitly says the brochure screen is the near-1:1 source of truth, not the token summary | Matches the user's stated intent exactly — "almost 1:1 inspiration," not a lossy palette extraction |

## Scope

**In scope:** `context/foundation/design-system.md` (new — reference doc + screen mapping), `context/foundation/lessons.md` (one new entry), `context/foundation/roadmap.md` (already updated this session with `F-02` + per-slice pointers).

**Out of scope:** any `src/` file, the brochure's marketing copy/landing-page sections, `docs/reference/contract-surfaces.md`, prescribing exact CSS values or component APIs (that's each slice's own `/10x-plan` decision, informed by this reference).

## Architecture / Approach

Pure reference-wiring: write the doc, then make its consultation mandatory via the one file the toolkit already re-reads automatically on every planning/implementation run.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Design system reference doc | `context/foundation/design-system.md` with the screen-mapping table | Table reads ambiguous or incomplete for a slice |
| 2. Lock the decision | `lessons.md` entry + final consistency check | Rule doesn't actually get picked up if phrased too vaguely |

**Prerequisites:** none — F-02 has no prerequisites in the roadmap.
**Estimated effort:** ~30 minutes, 2 phases, no code.

## Open Risks & Assumptions

- The brochure repo is private — future `/10x-plan`/`/10x-implement` runs need `gh repo clone`/`gh api` access, not plain `WebFetch` (which 404s on it). The doc calls this out explicitly so a future agent doesn't waste a turn discovering it.
- "Near-1:1 reference" is a directive for humans/agents to *read and replicate*, not an automated diff or lint — its effectiveness depends on the `lessons.md` rule actually being followed, which this change can document but not enforce mechanically.

## Success Criteria (Summary)

- For any of S-01–S-06, `design-system.md` gives an unambiguous "open this brochure screen" answer.
- The next `/10x-plan` run touching a UI slice surfaces the brochure reference without the user having to ask for it again.
- Zero application code changed in this session.
