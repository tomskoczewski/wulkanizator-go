# Tracker Status Sync Implementation Plan

## Overview

Teach `/10x-implement` and `/10x-archive` to automatically keep the linked GitHub issue and/or
Linear issue in sync with a change's real lifecycle state, per the lesson recorded in
`context/foundation/lessons.md` ("Sync Linear/GitHub status automatically on implementation
completion"). Today this sync is entirely manual — it was done by hand for `role-and-workshop-scope`
(GitHub #1, Linear TOM-5) in this same session, and the tracker sat stale (Backlog / open) for
hours after the PR had already merged and shipped to production.

## Current State Analysis

- `.claude/skills/10x-implement/SKILL.md:111-118` ("Tracking issue/task references for commits")
  already scans conversation text for issue references and stitches them into a commit message
  `Refs:` line — but it never calls out to GitHub or Linear. It's commit-message hygiene, not
  tracker sync.
- No `/10x-impl-review` skill exists in this repo yet (referenced by name as a future lesson in
  `CLAUDE.md` and in `10x-implement`'s own "Plan Completion" step) — so the lesson's "Applies to:
  implement, impl-review" only has `10x-implement` and `10x-archive` to land on today.
- `context/changes/<change-id>/change.md` has no stored reference to any external tracker issue
  (`10x-new/references/change-md.md` documents the schema as intentionally minimal — no
  `requires`/`blocked_by`, and by extension no tracker refs).
- A working manual convention already exists and was used to create GitHub #1 / Linear TOM-5:
  - `/10x-roadmap`'s "Backlog Handoff" table (`context/foundation/roadmap.md` `## Backlog
    Handoff`) seeds a suggested GitHub issue title per roadmap item.
  - The GitHub issue body for #1 contains the literal line `` **Change ID:** `role-and-workshop-scope` ``.
  - The Linear issue TOM-5 description contains `Roadmap ID: F-01` and a markdown link to the
    GitHub issue URL.
- `context/foundation/roadmap.md` already has a proven **two-ended best-effort sync pattern** for
  its own `Status` field: `/10x-implement` flips a matched roadmap item to `in-progress` on entry
  (`10x-implement/SKILL.md:120-138`, "## Roadmap status sync"), `/10x-archive` flips it to `done`
  on close (`10x-archive/SKILL.md:162-184`, "Move and stamp" step 5). Both are: best-effort (a
  missing roadmap or no-match is a silent skip, never a block), forward-only (never regress a
  more-advanced status), and print exactly one info/confirmation line either way so the lookup is
  provably run. This plan reuses that exact shape, pointed at GitHub/Linear instead of
  `roadmap.md`.
- Neither skill currently declares any `mcp__linear-server__*` tool in its `allowed-tools`
  frontmatter (confirmed by grep across all 16 skill files in this repo — none declare any `mcp__`
  tool today). `Bash` is already declared in both, which covers `gh` CLI use.

## Desired End State

- When `/10x-implement` finishes the final phase of a change (`change.md` → `implemented`), it
  best-effort looks up the change's linked GitHub issue and/or Linear issue via the existing
  Change ID / Roadmap ID text convention, posts a structured "delivered" summary comment on each
  found issue, and moves the Linear issue to its `In Review` status (GitHub issues have no native
  review state, so they're left open with the comment only).
- When `/10x-archive` archives a change, it best-effort posts a closing comment and moves the
  Linear issue to `Done` / closes the GitHub issue — mirroring the existing roadmap `done` close
  in the same step.
- A change with no matching roadmap item, or a tracker with zero/ambiguous matches, or missing
  `gh`/Linear tooling, produces exactly one info line per tracker and otherwise behaves identically
  to today — the ritual never blocks, never prompts, never guesses.
- Verify by: running `/10x-implement` on this very change (`tracker-status-sync`) — it has no
  roadmap item, so the desired-end-state check is that GitHub/Linear lookup prints its info line
  and skips cleanly, with zero behavior change to the rest of the epilogue ritual.

### Key Discoveries:

- The lookup convention (Change ID in GitHub body, Roadmap ID in Linear description) already
  works — it's exactly how GitHub #1 / Linear TOM-5 were found by hand earlier in this session.
- Both skills already have a `Bash`-based, best-effort, silent-skip-on-no-match pattern
  (`## Roadmap status sync`) that this plan's tracker sync should read as its template for tone,
  structure, and failure handling — not reinvent.
- `allowed-tools` frontmatter is the actual gate: this session called `mcp__linear-server__*` tools
  freely because it isn't running inside a restricted skill invocation. A skill invoked via
  `Skill(...)` is restricted to its declared `allowed-tools` list, so the Linear tool names must be
  added explicitly or the epilogue/archive steps will fail to call them.

## What We're NOT Doing

- Not adding a `tracker_refs` field to `change.md` — decided against a schema change in favor of
  the existing text-convention lookup (see Key Decisions in the brief).
- Not touching `/10x-impl-review` — it doesn't exist in this repo yet.
- Not running tracker sync per-phase — only at implement-epilogue and at archive.
- Not building a Jira integration — the lesson and this repo's actual usage only cover GitHub and
  Linear.
- Not auto-closing the GitHub issue at implement-epilogue time (only at archive) — "implemented"
  is not the same as "shipped/reviewed."
- Not prompting the user to disambiguate when a tracker lookup finds 2+ candidate issues — treated
  identically to zero matches (skip + info line), consistent with the roadmap-sync precedent.

## Implementation Approach

Both skills need the same lookup/comment/status-resolution logic, so it's written once as a shared
reference doc (`.claude/skills/10x-implement/references/tracker-sync.md`) — mirroring how
`references/progress-format.md` already lives under `10x-plan/references/` but is read by
`10x-implement`, `10x-archive`, and others. `10x-implement` and `10x-archive` each get a thin
"Tracker status sync" / "Tracker status close" step that names when to run the shared contract and
what target status to request, without duplicating the lookup mechanics prose twice.

## Critical Implementation Details

**Tool-gate ordering.** The shared reference doc's tool-availability check must run *before* any
`gh`/Linear tool call, and the two trackers must be checked and act fully independently (per the
"both, fully independent" decision) — a missing `gh` binary must not skip the Linear half, and a
Linear tool-call error must not skip the GitHub half.

**Linear status resolution must not be hardcoded.** Team-specific Linear workspaces name their
statuses differently. Resolve the target status by exact case-insensitive name match against
`mcp__linear-server__list_issue_statuses` output at call time (`"in review"` / `"done"`) — if no
status with that exact name exists on the issue's team, skip the status transition (comment still
posts) and print an info line. Do not fall back to matching by `type` (e.g. any `started`-type
status) — a team could have multiple `started`-type statuses and guessing the wrong one is worse
than skipping.

## Phase 1: Shared tracker-lookup reference doc

### Overview

Write the contract both skills will point to: how to find a change's linked GitHub/Linear issue,
how to check tool availability, how to resolve target statuses, and the comment template shape.
No behavior change to either skill yet — this phase only adds a new reference file.

### Changes Required:

#### 1. Tracker-sync reference contract

**File**: `.claude/skills/10x-implement/references/tracker-sync.md`

**Intent**: Define, once, the full lookup → comment → status-transition contract that Phase 2 and
Phase 3 both invoke by reference, keeping the mechanics out of the two `SKILL.md` files.

**Contract**: The doc must specify, as numbered/testable steps (mirroring the style of
`10x-implement/SKILL.md`'s existing "## Roadmap status sync" section):

1. **Resolve the roadmap item.** Reuse the same lookup already specified in `10x-implement`'s
   "## Roadmap status sync" (`## At a glance` table row or `### <ID>:` body block whose `Change
   ID` equals `<change-id>`, exact-string match). No match → print
   `ℹ no roadmap item for change "<change-id>" — tracker sync skipped.` and stop the entire
   contract (both trackers). This is the single shared precondition for both lookups.
2. **GitHub lookup** (independent tool-availability gate: `command -v gh >/dev/null 2>&1`; missing
   → print `ℹ gh CLI not available — GitHub tracker sync skipped.` and skip to step 3):
   - Derive `OWNER/REPO` from `git remote get-url origin` (strip a trailing `.git`, take the
     `owner/repo` path segment after `github.com[:/]`). Non-GitHub or missing remote → print
     `ℹ no GitHub remote — GitHub tracker sync skipped.` and skip to step 3.
   - List candidate issues and filter client-side for the exact Change ID marker — the non-obvious
     part is that `gh issue list --search` full-text search is unreliable for exact-substring
     matching, so pull bodies and filter with `jq`:
     ```bash
     gh issue list --repo "$OWNER/$REPO" --state all --limit 200 \
       --json number,state,url,body \
       | jq --arg marker "**Change ID:** \`$CHANGE_ID\`" \
         '[.[] | select(.body | contains($marker))]'
     ```
   - Exactly one result → that's the matched issue. Zero or 2+ → print
     `ℹ <N> GitHub issue(s) matched Change ID "<change-id>" — GitHub tracker sync skipped.` and
     continue to step 3 without acting.
3. **Linear lookup** (independent tool-availability gate: attempt the first Linear tool call;
   any error — tool not found, not permitted, connection failure — → print
   `ℹ Linear tools unavailable — Linear tracker sync skipped.` and skip to step 4):
   - Call `mcp__linear-server__list_issues` with `query: "<Roadmap ID>"` (the `F-NN`/`S-NN` value
     from step 1), requesting `fields: ["id","title","description"]`.
   - Confirm each candidate by exact substring: its `description` must contain
     `Roadmap ID: <Roadmap ID>` (case-sensitive, matching the convention observed in TOM-5).
     Exactly one confirmed match → that's the matched issue. Zero or 2+ → print
     `ℹ <N> Linear issue(s) matched Roadmap ID "<Roadmap ID>" — Linear tracker sync skipped.` and
     continue to step 4 without acting.
4. **Resolve target status** (Linear only; GitHub has no equivalent — see step 6). Given a target
   status name (`"In Review"` for epilogue, `"Done"` for archive, passed in by the caller — Phase 2
   / Phase 3), call `mcp__linear-server__list_issue_statuses` for the matched issue's team and find
   a status whose `name` case-insensitively equals the target. Not found → print
   `ℹ team "<team>" has no "<target>" status — Linear status left unchanged, comment still posts.`
   and proceed to step 5 with no status change.
5. **Build the comment body.** Read `context/changes/<change-id>/plan.md`'s `## Phase N: <name>`
   Overview blurbs (one line each) as the "Delivered" bullet list. If any `#### Manual` row in
   `## Progress` is still `- [ ]` at call time, add a "Deferred, non-blocking" bullet listing them
   (`<phase>.<index> <title>`). Always include a closing line pointing to
   `context/changes/<change-id>/plan.md`. The caller (Phase 2 / Phase 3) supplies the opening
   sentence (e.g. "Implemented via `/10x-implement`…" vs. "Archived — closed as done…").
6. **Post and transition, per tracker, independently:**
   - GitHub (if matched in step 2): `gh issue comment <number> --repo "$OWNER/$REPO" --body "..."`.
     Only close it (`gh issue close <number> --repo "$OWNER/$REPO" --reason completed`) when the
     caller is Phase 3 (archive) — never at epilogue time.
   - Linear (if matched in step 3): `mcp__linear-server__save_comment` with `issueId` set to the
     matched issue's id. If step 4 resolved a target status, also call
     `mcp__linear-server__save_issue` with `id` and `state` set to that status's name.
7. **Print one outcome line per tracker**, whether acted or skipped, in the caller's existing
   completion-summary style (see `10x-archive/SKILL.md`'s `roadmap.md: closed <ID> ...` confirmation
   line for the tone to match) — e.g. `github: commented on #<n>` / `github: skipped (<reason>)`,
   `linear: commented + moved <id> to "<status>"` / `linear: skipped (<reason>)`.

### Success Criteria:

#### Automated Verification:

- File exists: `test -f .claude/skills/10x-implement/references/tracker-sync.md`
- Formatting is clean: `npx prettier --check .claude/skills/10x-implement/references/tracker-sync.md`

#### Manual Verification:

- Read through the contract once and confirm every step names an explicit skip condition and info
  line — no step can silently do nothing without printing why.

---

## Phase 2: Wire into `/10x-implement` epilogue

### Overview

Call the Phase 1 contract at the end of `/10x-implement`'s "After all phases" flow, targeting
Linear's `In Review` status, GitHub comment-only.

### Changes Required:

#### 1. Allow the Linear tools

**File**: `.claude/skills/10x-implement/SKILL.md`

**Intent**: The epilogue step needs to call Linear MCP tools; without declaring them in
`allowed-tools`, the skill invocation can't reach them.

**Contract**: Add to the frontmatter `allowed-tools` list (alongside the existing entries):
`mcp__linear-server__list_issues`, `mcp__linear-server__get_issue`,
`mcp__linear-server__list_issue_statuses`, `mcp__linear-server__save_issue`,
`mcp__linear-server__save_comment`.

#### 2. Epilogue tracker sync step

**File**: `.claude/skills/10x-implement/SKILL.md`

**Intent**: After the epilogue commit lands (the existing "After all phases" step 4), run the
Phase 1 contract once, targeting Linear status `"In Review"`, and never closing the GitHub issue.

**Contract**: New step 5 under "After all phases" (renumbering nothing else — it's additive,
appended after the existing step 4's sub-steps), titled `## Tracker status sync`, that: (a) points
to `references/tracker-sync.md` as the authoritative contract, (b) states the caller-supplied
opening sentence — `` Implemented via `/10x-implement` (change `<change-id>`, final commit
`<epilogue-SHA-or-final-phase-SHA>`). `` — and target status `"In Review"`, (c) states this step is
itself best-effort and must never block, re-open, or fail the epilogue that already committed, (d)
folds its per-tracker outcome lines into the existing completion summary printed under "Plan
Completion" (`All phases implemented! 🎉 ...`), so the user sees tracker outcomes in the same place
they see the phase/file summary today.

### Success Criteria:

#### Automated Verification:

- Formatting is clean: `npx prettier --check .claude/skills/10x-implement/SKILL.md`
- New tool names present: `grep -c "mcp__linear-server__save_comment" .claude/skills/10x-implement/SKILL.md` returns ≥ 1

#### Manual Verification:

- Run `/10x-implement tracker-status-sync` through to its own epilogue (this plan's own
  implementation). Since `tracker-status-sync` has no roadmap item, confirm the new step prints
  exactly the "no roadmap item — tracker sync skipped" info line and the rest of the epilogue
  (change.md status flip, epilogue commit) behaves identically to before this change.
- The first *real* end-to-end happy-path check (GitHub comment + Linear "In Review" actually
  posted) can only happen the next time a roadmap-linked change reaches implement-epilogue — flag
  this as a deferred manual check the same way `role-and-workshop-scope`'s 5.6 was deferred (see
  Open Risks in the brief).

---

## Phase 3: Wire into `/10x-archive`

### Overview

Mirror Phase 2 at the archive end: call the same Phase 1 contract targeting Linear `"Done"` and
closing the GitHub issue, in the same step that already closes the matching roadmap item.

### Changes Required:

#### 1. Allow the Linear tools

**File**: `.claude/skills/10x-archive/SKILL.md`

**Intent**: Same reason as Phase 2 Change 1 — the archive-time close needs the Linear tools
declared to be callable.

**Contract**: Add the same five `mcp__linear-server__*` tool names (see Phase 2 Change 1) to this
skill's frontmatter `allowed-tools` list.

#### 2. Archive-time tracker close step

**File**: `.claude/skills/10x-archive/SKILL.md`

**Intent**: Immediately after "Move and stamp" step 5 (the existing roadmap `done` close) and
before step 6 (the archive commit), run the Phase 1 contract targeting Linear status `"Done"` and
closing the matched GitHub issue.

**Contract**: New numbered sub-step under "Move and stamp", titled `Close linked trackers`, that:
(a) points to `10x-implement/references/tracker-sync.md` as the authoritative contract (cross-skill
reference, same pattern as this skill already following `10x-plan/references/progress-format.md`
for Progress-section rules), (b) states the caller-supplied opening sentence — `Archived — change
"<change-id>" closed as done (` + DEST` + `).` — and target status `"Done"`, with GitHub close
enabled, (c) is isolated from the archive commit and rollback logic exactly like the existing
roadmap-close step ("Move and stamp" step 5) already is — any failure here is caught, noted in the
confirmation output, and never aborts the archive, (d) adds its per-tracker outcome lines to the
existing "Print confirmation" block, on the same lines as the `roadmap.md: closed <ID> ...` line.

### Success Criteria:

#### Automated Verification:

- Formatting is clean: `npx prettier --check .claude/skills/10x-archive/SKILL.md`
- New tool names present: `grep -c "mcp__linear-server__save_comment" .claude/skills/10x-archive/SKILL.md` returns ≥ 1

#### Manual Verification:

- Run `/10x-archive tracker-status-sync` on this change once implemented. Since it has no roadmap
  item, confirm the "no roadmap item — tracker sync skipped" info line prints and the archive
  otherwise proceeds identically to today (folder move, `change.md` stamp, commit).
- Same deferred caveat as Phase 2: the real close-and-comment happy path can only be verified the
  next time a roadmap-linked change is archived.

---

## Testing Strategy

### Unit Tests:

- Not applicable — these are prompt/instruction files, not executable code. "Testing" is a human
  (or a future agent) reading the contract and running it against real changes.

### Integration Tests:

- The manual verification steps in Phase 2 and Phase 3 are the integration test: running this
  change's own `/10x-implement` epilogue and `/10x-archive` exercises the full skip path
  end-to-end (no roadmap item → clean no-op on both trackers).

### Manual Testing Steps:

1. Run `/10x-implement tracker-status-sync` through all 3 phases and confirm the epilogue's
   tracker-sync step prints the expected skip info line.
2. Run `/10x-archive tracker-status-sync` and confirm the same skip behavior at archive time.
3. Read both updated `SKILL.md` files end-to-end once more after editing to confirm no existing
   section (roadmap sync, commit ritual, Progress rules) was disturbed by the additions.

## Performance Considerations

None — these are best-effort steps bounded by a handful of API/CLI calls per lifecycle transition,
not a hot path.

## Migration Notes

Not applicable — no data migration. Existing changes (e.g. `role-and-workshop-scope`, already
`implemented`) are unaffected; the new steps only fire on future `/10x-implement` epilogues and
`/10x-archive` runs.

## References

- Lesson: `context/foundation/lessons.md` — "Sync Linear/GitHub status automatically on
  implementation completion"
- Precedent pattern: `.claude/skills/10x-implement/SKILL.md:120-138` ("## Roadmap status sync")
- Precedent pattern: `.claude/skills/10x-archive/SKILL.md:162-184` ("Move and stamp" step 5)
- Shared cross-skill reference precedent: `.claude/skills/10x-plan/references/progress-format.md`
- Manually-performed prior art (same session): GitHub #1 / Linear TOM-5 status sync, and the
  TOM-21 / GitHub #18 follow-up issue for the deferred item this pattern would have caught
  automatically.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared tracker-lookup reference doc

#### Automated

- [x] 1.1 File exists: `test -f .claude/skills/10x-implement/references/tracker-sync.md`
- [x] 1.2 Formatting is clean: `npx prettier --check .claude/skills/10x-implement/references/tracker-sync.md`

#### Manual

- [x] 1.3 Every contract step names an explicit skip condition and info line

### Phase 2: Wire into `/10x-implement` epilogue

#### Automated

- [ ] 2.1 Formatting is clean: `npx prettier --check .claude/skills/10x-implement/SKILL.md`
- [ ] 2.2 New tool names present in `10x-implement/SKILL.md`

#### Manual

- [ ] 2.3 `/10x-implement tracker-status-sync` epilogue prints the no-roadmap-item skip line; rest of epilogue unchanged
- [ ] 2.4 Real happy-path check deferred to the next roadmap-linked change's epilogue

### Phase 3: Wire into `/10x-archive`

#### Automated

- [ ] 3.1 Formatting is clean: `npx prettier --check .claude/skills/10x-archive/SKILL.md`
- [ ] 3.2 New tool names present in `10x-archive/SKILL.md`

#### Manual

- [ ] 3.3 `/10x-archive tracker-status-sync` prints the no-roadmap-item skip line; rest of archive unchanged
- [ ] 3.4 Real happy-path check deferred to the next roadmap-linked change's archive
