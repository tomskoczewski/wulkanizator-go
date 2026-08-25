---
project: "Wulkanizator GO"
source: context/foundation/roadmap.md
mirrors: roadmap v1
repo: tomskoczewski/wulkanizator-go
milestone: MVP
generated: 2026-08-14
last_synced: 2026-08-25 # S-05 parked (#6 closed as not planned)
---

# Task management system: GitHub Issues

Wulkanizator GO's backlog lives in **GitHub Issues** on `tomskoczewski/wulkanizator-go`, migrated 1:1 from `context/foundation/roadmap.md` (v1) via the `gh` CLI. This file is the mirror/index — `roadmap.md` remains the source of truth for scope and rationale; this file tracks where each roadmap item landed in GitHub.

All 16 issues sit under one milestone, `MVP`, and carry a `type:*` label plus (where applicable) a `stream:*` label matching the roadmap's Streams table. Two (#6 S-05, #7 S-06) have since been relabelled `type:parked` and closed — see §Parked.

## Labels

| Label | Meaning |
| --- | --- |
| `type:foundation` | Enabling/infra work, not itself user-visible |
| `type:slice` | Vertical, user-visible roadmap slice |
| `type:question` | Open roadmap question needing a user decision |
| `type:parked` | Explicitly out of MVP scope, kept for later |
| `stream:a-core-loop` | North-star chain: F-01 → S-01 → S-02 → S-03 |
| `stream:b-worker` | Worker adoption (S-04) |
| `stream:c-customer` | Customer directory (S-05) — retained on #6 though the slice is parked, so it comes back labelled if un-parked |
| `stream:d-tire-storage` | Tire storage extension (S-06) — retained on #7 though the slice is parked, so it comes back labelled if un-parked |
| `north-star` | Marks the one slice (S-03) where the core loop closes end-to-end |

## Backlog issues (foundation + slices)

| Roadmap ID | GitHub issue | Title | Labels | Depends on |
| --- | --- | --- | --- | --- |
| F-01 | [#1](https://github.com/tomskoczewski/wulkanizator-go/issues/1) | Foundation: user role + workshop scope (RLS, route-guard) | `type:foundation`, `stream:a-core-loop` | — |
| S-01 | [#2](https://github.com/tomskoczewski/wulkanizator-go/issues/2) | Workshop setup: bays, hours, services | `type:slice`, `stream:a-core-loop` | #1 (F-01) |
| S-02 | [#3](https://github.com/tomskoczewski/wulkanizator-go/issues/3) | Add appointment with free-slot suggestions | `type:slice`, `stream:a-core-loop` | #2 (S-01) |
| S-03 | [#4](https://github.com/tomskoczewski/wulkanizator-go/issues/4) | Day plan — appointments with statuses (**north star**) | `type:slice`, `stream:a-core-loop`, `north-star` | #3 (S-02) |
| S-04 | [#5](https://github.com/tomskoczewski/wulkanizator-go/issues/5) | Worker changes appointment status | `type:slice`, `stream:b-worker` | #4 (S-03), #1 (F-01) |

S-05 was in this table until 2026-08-25; it now sits under §Parked, alongside S-06 (removed 2026-08-21).

Dependencies are also recorded as a GitHub task-list (`- [ ] Depends on #N`) in each dependent issue's body, so they render as clickable, checkable cross-references in the GitHub UI.

## Open questions

| Roadmap ref | GitHub issue | Title | Blocks |
| --- | --- | --- | --- |
| Open Roadmap Q1 | [#8](https://github.com/tomskoczewski/wulkanizator-go/issues/8) | Missing user stories for remaining MVP flows | roadmap-wide (non-blocking) |

Open Roadmap Q2 (#9, "Are revenue/forecast reports part of the MVP?") was in this table until 2026-08-25, when it was resolved moot — its only blocking condition, S-05, is itself now parked. It moved to §Parked alongside #6/#7 rather than staying open with nothing left to block.

## Parked

| Roadmap ref | GitHub issue | Title |
| --- | --- | --- |
| Parked | [#10](https://github.com/tomskoczewski/wulkanizator-go/issues/10) | Native mobile app (iOS/Android) |
| Parked | [#11](https://github.com/tomskoczewski/wulkanizator-go/issues/11) | Accounting / invoicing integration |
| Parked | [#12](https://github.com/tomskoczewski/wulkanizator-go/issues/12) | SMS/email notifications to customers |
| Parked | [#13](https://github.com/tomskoczewski/wulkanizator-go/issues/13) | Multi-tenant (multiple workshops on one account) |
| Parked | [#14](https://github.com/tomskoczewski/wulkanizator-go/issues/14) | Manual slot override |
| Parked | [#15](https://github.com/tomskoczewski/wulkanizator-go/issues/15) | Per-bay / per-worker filter on day plan |
| Parked | [#16](https://github.com/tomskoczewski/wulkanizator-go/issues/16) | Variable service duration by car type |
| S-05 → Parked | [#6](https://github.com/tomskoczewski/wulkanizator-go/issues/6) | Customer directory with cars — **closed 2026-08-25 as `not planned`** |
| S-06 → Parked | [#7](https://github.com/tomskoczewski/wulkanizator-go/issues/7) | Tire storage (nice-to-have) — **closed 2026-08-21 as `not planned`** |
| Open Roadmap Q2 → Parked | [#9](https://github.com/tomskoczewski/wulkanizator-go/issues/9) | Are revenue/forecast reports part of the MVP? — **left open**, its only blocking condition (S-05) is parked; see note below |

Note on #6: parked 2026-08-25 after user review of `/10x-research`'s findings (`context/archive/2026-08-25-customer-directory/research.md`) — relabelled `type:slice` → `type:parked` and closed as `not planned`, same treatment as #7 below. The rationale, accepted risk, and re-entry trigger live in `roadmap.md` §S-05, which was deliberately kept in place rather than deleted. Because #7/S-06 depends on #6/S-05, un-parking S-06 first requires un-parking S-05.

Note on #7: the roadmap's Parked section originally carried tire storage as a *conditional* bullet cross-referencing S-06's own Unknown, so it was never migrated as a separate parked issue. On 2026-08-21 that condition resolved to "park it" — #7 was relabelled `type:slice` → `type:parked` and closed as `not planned`, and the roadmap bullet became unconditional. Un-parking means reopening #7 and reversing the label swap; the rationale and re-entry trigger live in `roadmap.md` §S-06, which was deliberately kept in place rather than deleted.

Note on #9: unlike #6/#7 this issue was **not** relabelled or closed — it's a genuine open question, just one whose blocking condition evaporated. It's listed here for visibility alongside the two parked slices rather than left in the Open Questions table implying it still gates something. If a future un-park of S-05 revives the "revenue and forecast" scope question, move #9 back to the Open Questions table.

## Keeping this in sync

`roadmap.md` is edit-in-place; this file is not automatically regenerated. When `roadmap.md` changes (new slice, status flip to `done`, a parked item promoted back into scope), update the corresponding GitHub issue via `gh issue edit`/`gh issue close` and reflect the change here.
