# Tracker Status Sync — Plan Brief

> Full plan: `context/changes/tracker-status-sync/plan.md`

## What & Why

Teach `/10x-implement` and `/10x-archive` to automatically post a status comment and transition the
linked GitHub/Linear issue when a change reaches implement-epilogue or gets archived — instead of
relying on someone remembering to do it by hand. Direct follow-on from the lesson recorded in
`context/foundation/lessons.md` after `role-and-workshop-scope`'s GitHub #1 / Linear TOM-5 sat stale
for hours after the PR had already merged and shipped.

## Starting Point

Neither skill touches any tracker today. `10x-implement` only stitches issue references into commit
message `Refs:` lines (text, no API calls). The only thing that already syncs automatically is
`context/foundation/roadmap.md`'s own `Status` field, via a proven best-effort pattern:
`10x-implement` flips a matched item to `in-progress` on entry, `10x-archive` flips it to `done` on
close. No skill currently declares any Linear MCP tool in its `allowed-tools` frontmatter.

## Desired End State

A change with a matching roadmap item and a discoverable GitHub/Linear issue gets, automatically:
a "Delivered" summary comment + Linear → `In Review` when `/10x-implement` finishes its last phase,
and a closing comment + Linear → `Done` / GitHub closed when `/10x-archive` runs. A change with no
roadmap item, no matched issue, or missing tooling behaves exactly as it does today, plus one info
line per tracker explaining the skip.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Issue lookup mechanism | Heuristic text search (Change ID in GH body, Roadmap ID in Linear description) | Zero schema change, matches the exact manual process already proven for GitHub #1 / Linear TOM-5. |
| Lifecycle trigger split | `/10x-implement` epilogue → review state; `/10x-archive` → done state | Reuses the exact two-ended pattern already proven for `roadmap.md`'s own status sync. |
| Review-state mapping | Linear → `In Review`; GitHub → stays open, comment only | GitHub issues have no native review state; Linear teams here already have one. |
| Ambiguous/zero matches | Skip silently with one info line per tracker | Matches the existing roadmap-sync contract; never turns a best-effort step into a blocking prompt. |
| Tool unavailability | Per-tracker independent best-effort skip | Most projects using this toolkit won't have Linear/GitHub configured at all — must default to no-op. |
| Per-phase vs. completion-only | Only at epilogue and archive | Avoids spamming the issue thread with one comment per phase; matches how the manual sync was actually used. |
| Tracker scope | Both GitHub and Linear, fully independent | Matches this project's actual setup and the lesson's explicit wording. |
| Comment detail | Structured "Delivered" bullets pulled from plan Phase Overviews + pending manual items | Proven useful format from the manual TOM-5/#1 comment; mechanically derivable from the plan, nothing to invent. |

## Scope

**In scope:**
- New shared reference doc: lookup, tool-gate, status-resolution, and comment-template contract
- `/10x-implement` epilogue: comment + Linear → `In Review`
- `/10x-archive`: comment + Linear → `Done` / GitHub close
- `allowed-tools` frontmatter updates on both skills

**Out of scope:**
- `/10x-impl-review` (doesn't exist in this repo yet)
- A `tracker_refs` field on `change.md`
- Per-phase tracker comments
- Jira or any tracker beyond GitHub/Linear
- Disambiguation prompts on multi-match

## Architecture / Approach

One shared contract (`10x-implement/references/tracker-sync.md`) is read by two thin call sites —
mirrors how `references/progress-format.md` already serves multiple skills. Both call sites reuse
the existing roadmap-item lookup as their shared precondition: no roadmap item → no tracker lookup
at all, for either tracker.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared reference doc | Lookup/comment/status contract, no behavior change | Under-specifying a skip condition leaves a silent do-nothing step |
| 2. `/10x-implement` epilogue | Delivered-comment + Linear "In Review" on completion | Can only be end-to-end verified against a real roadmap-linked change, not this one |
| 3. `/10x-archive` close | Closing comment + Linear "Done" / GitHub close on archive | Same verification gap as Phase 2 |

**Prerequisites:** None — both target skills already exist and are stable.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The heuristic lookup depends on the Change ID / Roadmap ID text convention being followed
  exactly in future issues — it isn't enforced anywhere, only observed as existing practice.
- This change itself (`tracker-status-sync`) has no roadmap item, so its own manual verification
  can only prove the *skip* path works. The real happy path (comment posted, status moved) won't
  be exercised until the next roadmap-linked change reaches implement-epilogue or archive.
- Linear status names are workspace-specific; if a future team renames "In Review" or "Done", the
  transition silently no-ops (comment still posts) rather than guessing a different status.

## Success Criteria (Summary)

- A roadmap-linked change, once fully implemented, gets its GitHub/Linear issue automatically
  commented on and moved to a review state — no manual follow-up needed.
- A change with no tracker link (like this one) sees zero behavior change beyond one extra info
  line per lifecycle step.
- Archiving a change closes its trackers the same way `/10x-archive` already closes its roadmap
  item.
