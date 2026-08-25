---
project: "Wulkanizator GO"
source: context/foundation/roadmap.md
mirrors: tasks-github.md
workspace: Tomsko
team: Tomsko
linear_project: Wulkanizator GO
milestone: MVP
generated: 2026-08-14
---

# Task management system: Linear

Wulkanizator GO's backlog is also mirrored into **Linear**, workspace `Tomsko`, team `Tomsko`, project [Wulkanizator GO](https://linear.app/tomsko/project/wulkanizator-go-f6404b7211b3), migrated 1:1 from `context/foundation/tasks-github.md` (which itself mirrors `roadmap.md` v1) via the `linear-server` MCP tools. `roadmap.md` remains the source of truth for scope and rationale; `tasks-github.md` is the GitHub mirror; this file is the Linear mirror/index.

All 16 issues sit in the `Wulkanizator GO` project under one milestone, `MVP` (mirroring GitHub's milestone assignment exactly, including the open-question and parked issues), and carry a `type:*` label plus (where applicable) a `stream:*` label matching the roadmap's Streams table. Two further issues (TOM-21, TOM-22) were created after this initial migration and were missing from this mirror until 2026-08-25 — see §Additional issues below. Both carry no milestone (matching their GitHub counterparts, #18 and #20, which are also unmilestoned).

## Labels

Team-scoped labels on `Tomsko`, matching `tasks-github.md`'s label table verbatim:

| Label | Meaning |
| --- | --- |
| `type:foundation` | Enabling/infra work, not itself user-visible |
| `type:slice` | Vertical, user-visible roadmap slice |
| `type:question` | Open roadmap question needing a user decision |
| `type:parked` | Explicitly out of MVP scope, kept for later |
| `stream:a-core-loop` | North-star chain: F-01 → S-01 → S-02 → S-03 |
| `stream:b-worker` | Worker adoption (S-04) |
| `stream:c-customer` | Customer directory (S-05) — retained on TOM-10 though the slice is parked, so it comes back labelled if un-parked |
| `stream:d-tire-storage` | Tire storage extension (S-06) — retained on TOM-11 though the slice is parked, so it comes back labelled if un-parked |
| `north-star` | Marks the one slice (S-03) where the core loop closes end-to-end |

## Backlog issues (foundation + slices)

| Roadmap ID | GitHub issue | Linear issue | Title | Labels | Depends on |
| --- | --- | --- | --- | --- | --- |
| F-01 | [#1](https://github.com/tomskoczewski/wulkanizator-go/issues/1) | [TOM-5](https://linear.app/tomsko/issue/TOM-5/foundation-user-role-workshop-scope-rls-route-guard) | Foundation: user role + workshop scope (RLS, route-guard) | `type:foundation`, `stream:a-core-loop` | — |
| S-01 | [#2](https://github.com/tomskoczewski/wulkanizator-go/issues/2) | [TOM-6](https://linear.app/tomsko/issue/TOM-6/workshop-setup-bays-hours-services) | Workshop setup: bays, hours, services | `type:slice`, `stream:a-core-loop` | TOM-5 (F-01) |
| S-02 | [#3](https://github.com/tomskoczewski/wulkanizator-go/issues/3) | [TOM-7](https://linear.app/tomsko/issue/TOM-7/add-appointment-with-free-slot-suggestions) | Add appointment with free-slot suggestions | `type:slice`, `stream:a-core-loop` | TOM-6 (S-01) |
| S-03 | [#4](https://github.com/tomskoczewski/wulkanizator-go/issues/4) | [TOM-8](https://linear.app/tomsko/issue/TOM-8/day-plan-appointments-with-statuses) | Day plan — appointments with statuses (**north star**) | `type:slice`, `stream:a-core-loop`, `north-star` | TOM-7 (S-02) |
| S-04 | [#5](https://github.com/tomskoczewski/wulkanizator-go/issues/5) | [TOM-9](https://linear.app/tomsko/issue/TOM-9/worker-changes-appointment-status) | Worker changes appointment status | `type:slice`, `stream:b-worker` | TOM-8 (S-03), TOM-5 (F-01) |
| F-02 | [#20](https://github.com/tomskoczewski/wulkanizator-go/issues/20) | [TOM-22](https://linear.app/tomsko/issue/TOM-22/design-system-foundation-brochure-as-the-canonical-ui-reference) | Design system foundation (brochure as the canonical UI reference) | `type:foundation` | — |

S-05 and S-06 were in this table until 2026-08-25; they now sit under §Parked. F-02 was added to this table 2026-08-25 — it was migrated to Linear separately from the original batch (see §Additional issues) and had never been added here.

Unlike GitHub (which fakes dependencies with a checklist in the issue body), Linear has native issue-blocking relations: each dependent issue above was created with a `blockedBy` relation pointing at its dependency's Linear ID, verified via `get_issue(includeRelations: true)`. The same "Depends on: ..." text also appears in each issue's description for parity with the GitHub mirror.

## Open questions

| Roadmap ref | GitHub issue | Linear issue | Title | Blocks |
| --- | --- | --- | --- | --- |
| Open Roadmap Q1 | [#8](https://github.com/tomskoczewski/wulkanizator-go/issues/8) | [TOM-12](https://linear.app/tomsko/issue/TOM-12/missing-user-stories-for-remaining-mvp-flows) | Missing user stories for remaining MVP flows | roadmap-wide (non-blocking) |

Open Roadmap Q2 (TOM-13, "Are revenue/forecast reports part of the MVP?") was in this table until 2026-08-25, when it was resolved moot — its only blocking condition, S-05, is itself now parked. It moved to §Parked alongside TOM-10/TOM-11 rather than staying open with nothing left to block. TOM-13 itself was **not** relabelled or closed in Linear — it's a genuine open question, just one whose blocking condition evaporated.

## Parked

| Roadmap ref | GitHub issue | Linear issue | Title |
| --- | --- | --- | --- |
| Parked | [#10](https://github.com/tomskoczewski/wulkanizator-go/issues/10) | [TOM-14](https://linear.app/tomsko/issue/TOM-14/native-mobile-app-iosandroid) | Native mobile app (iOS/Android) |
| Parked | [#11](https://github.com/tomskoczewski/wulkanizator-go/issues/11) | [TOM-15](https://linear.app/tomsko/issue/TOM-15/accounting-invoicing-integration) | Accounting / invoicing integration |
| Parked | [#12](https://github.com/tomskoczewski/wulkanizator-go/issues/12) | [TOM-16](https://linear.app/tomsko/issue/TOM-16/smsemail-notifications-to-customers) | SMS/email notifications to customers |
| Parked | [#13](https://github.com/tomskoczewski/wulkanizator-go/issues/13) | [TOM-17](https://linear.app/tomsko/issue/TOM-17/multi-tenant-multiple-workshops-on-one-account) | Multi-tenant (multiple workshops on one account) |
| Parked | [#14](https://github.com/tomskoczewski/wulkanizator-go/issues/14) | [TOM-18](https://linear.app/tomsko/issue/TOM-18/manual-slot-override) | Manual slot override |
| Parked | [#15](https://github.com/tomskoczewski/wulkanizator-go/issues/15) | [TOM-19](https://linear.app/tomsko/issue/TOM-19/per-bay-per-worker-filter-on-day-plan) | Per-bay / per-worker filter on day plan |
| Parked | [#16](https://github.com/tomskoczewski/wulkanizator-go/issues/16) | [TOM-20](https://linear.app/tomsko/issue/TOM-20/variable-service-duration-by-car-type) | Variable service duration by car type |
| S-05 → Parked | [#6](https://github.com/tomskoczewski/wulkanizator-go/issues/6) | [TOM-10](https://linear.app/tomsko/issue/TOM-10/customer-directory-with-cars) | Customer directory with cars — **canceled 2026-08-25** |
| S-06 → Parked | [#7](https://github.com/tomskoczewski/wulkanizator-go/issues/7) | [TOM-11](https://linear.app/tomsko/issue/TOM-11/tire-storage-nice-to-have) | Tire storage (nice-to-have) — **canceled 2026-08-25** |
| Open Roadmap Q2 → Parked | [#9](https://github.com/tomskoczewski/wulkanizator-go/issues/9) | [TOM-13](https://linear.app/tomsko/issue/TOM-13/are-revenueforecast-reports-part-of-the-mvp) | Are revenue/forecast reports part of the MVP? — **left open**, its only blocking condition (S-05) is parked |

Note: same as `tasks-github.md`, the roadmap's Parked section has a bullet ("Revenue and forecast reports") that is not a separate parked item until 2026-08-25 — it was migrated as Open Roadmap Q2 / TOM-13 above, and moved to this table only as a cross-reference note, not relabelled or canceled itself.

Note on TOM-10/TOM-11: parked 2026-08-25 after user review of `/10x-research`'s findings for S-05 (`context/archive/2026-08-25-customer-directory/research.md`), relabelled `type:slice` → `type:parked` and transitioned to `Canceled`. **Correction made in the same pass**: TOM-11 (S-06) had been left `Backlog`/`type:slice` in Linear since its 2026-08-21 park — GitHub #7 was closed and this file was updated to say so, but the Linear issue itself was never actually transitioned. That drift is now fixed. Since TOM-11 depends on TOM-10, un-parking S-06 first requires un-parking S-05; rationale and re-entry triggers live in `roadmap.md` §S-05 and §S-06.

**Also found in the same pass, while checking F-01/F-02 for the same kind of drift**: S-01 through S-04 (TOM-6 through TOM-9) were themselves stuck at `Backlog`/`In Review` in Linear despite being archived weeks earlier — none had ever been transitioned to `Done`. All four were transitioned to `Done` 2026-08-25, mirroring GitHub #2–#5 (closed `completed` the same day). F-01 (TOM-5) and F-02 (TOM-22) were checked at the same time and found already correctly `Done` — no drift there.

## Additional issues (created after the initial migration)

Two issues exist outside the original 16-issue batch this file was generated from. Both were missing from this mirror until 2026-08-25, discovered while checking F-01/F-02 tracker status for drift — added now to close the gap.

| GitHub issue | Linear issue | Title | Roadmap ID | Labels | Notes |
| --- | --- | --- | --- | --- | --- |
| [#20](https://github.com/tomskoczewski/wulkanizator-go/issues/20) | [TOM-22](https://linear.app/tomsko/issue/TOM-22/design-system-foundation-brochure-as-the-canonical-ui-reference) | Design system foundation (brochure as the canonical UI reference) | F-02 | `type:foundation` | Migrated separately from the original batch (no milestone). Already listed in the §Backlog issues table above as of 2026-08-25. `Done`, completed 2026-08-15 — no drift found. |
| [#18](https://github.com/tomskoczewski/wulkanizator-go/issues/18) | [TOM-21](https://linear.app/tomsko/issue/TOM-21/verify-readme-worker-promotion-snippet-in-production) | Verify README worker-promotion snippet in production | — (not a roadmap slice) | `type:foundation`, `stream:a-core-loop` | Deferred follow-up from F-01 (plan item 5.6, left unchecked at ship time) — production verification of the worker-promotion SQL snippet in README.md. TOM-21 was `Done` since 2026-08-15, but GitHub #18 was left open until closed `completed` 2026-08-25 to match. Depends on TOM-5 (F-01). |

## Differences from the GitHub mirror

- **Milestone scope**: confirmed with the user before creation — all 16 issues (including the 2 open questions and 7 parked items) were placed under the `MVP` milestone, mirroring GitHub's milestone assignment exactly rather than restricting it to the 7 backlog/slice issues.
- **Dependencies**: GitHub encodes "Depends on" as a markdown task-list in the issue body (no native dependency graph). Linear issues use native `blockedBy` issue relations in addition to the same descriptive text, so the dependency graph is queryable/renderable natively in Linear.
- **Team vs. repo**: GitHub issues live in the `tomskoczewski/wulkanizator-go` repo; Linear issues live in the `Tomsko` team (the only team in this workspace) scoped to the `Wulkanizator GO` project — there was no existing Linear project or team dedicated to this codebase before this mirror.
- **Labels**: created fresh as team-scoped Linear labels with names copied verbatim from `tasks-github.md` (e.g. `type:slice`, `stream:a-core-loop`), including the colon-namespaced style, rather than using Linear's native label-grouping feature — kept as a literal 1:1 name mirror instead of restructuring into label groups.

## Keeping this in sync

`roadmap.md` is edit-in-place; neither `tasks-github.md` nor this file is automatically regenerated. When `roadmap.md` changes (new slice, status flip to `done`, a parked item promoted back into scope), update the corresponding GitHub issue via `gh issue edit`/`gh issue close`, update the corresponding Linear issue via the `linear-server` MCP tools (`save_issue`, `save_milestone`, etc.), and reflect the change in both `tasks-github.md` and this file.
