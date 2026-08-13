---
project: "Wulkanizator GO"
source: context/foundation/roadmap.md
mirrors: roadmap v1
repo: tomskoczewski/wulkanizator-go
milestone: MVP
generated: 2026-08-14
---

# Task management system: GitHub Issues

Wulkanizator GO's backlog lives in **GitHub Issues** on `tomskoczewski/wulkanizator-go`, migrated 1:1 from `context/foundation/roadmap.md` (v1) via the `gh` CLI. This file is the mirror/index — `roadmap.md` remains the source of truth for scope and rationale; this file tracks where each roadmap item landed in GitHub.

All 16 issues sit under one milestone, `MVP`, and carry a `type:*` label plus (where applicable) a `stream:*` label matching the roadmap's Streams table.

## Labels

| Label | Meaning |
| --- | --- |
| `type:foundation` | Enabling/infra work, not itself user-visible |
| `type:slice` | Vertical, user-visible roadmap slice |
| `type:question` | Open roadmap question needing a user decision |
| `type:parked` | Explicitly out of MVP scope, kept for later |
| `stream:a-core-loop` | North-star chain: F-01 → S-01 → S-02 → S-03 |
| `stream:b-worker` | Worker adoption (S-04) |
| `stream:c-customer` | Customer directory (S-05) |
| `stream:d-tire-storage` | Tire storage extension (S-06) |
| `north-star` | Marks the one slice (S-03) where the core loop closes end-to-end |

## Backlog issues (foundation + slices)

| Roadmap ID | GitHub issue | Title | Labels | Depends on |
| --- | --- | --- | --- | --- |
| F-01 | [#1](https://github.com/tomskoczewski/wulkanizator-go/issues/1) | Foundation: user role + workshop scope (RLS, route-guard) | `type:foundation`, `stream:a-core-loop` | — |
| S-01 | [#2](https://github.com/tomskoczewski/wulkanizator-go/issues/2) | Workshop setup: bays, hours, services | `type:slice`, `stream:a-core-loop` | #1 (F-01) |
| S-02 | [#3](https://github.com/tomskoczewski/wulkanizator-go/issues/3) | Add appointment with free-slot suggestions | `type:slice`, `stream:a-core-loop` | #2 (S-01) |
| S-03 | [#4](https://github.com/tomskoczewski/wulkanizator-go/issues/4) | Day plan — appointments with statuses (**north star**) | `type:slice`, `stream:a-core-loop`, `north-star` | #3 (S-02) |
| S-04 | [#5](https://github.com/tomskoczewski/wulkanizator-go/issues/5) | Worker changes appointment status | `type:slice`, `stream:b-worker` | #4 (S-03), #1 (F-01) |
| S-05 | [#6](https://github.com/tomskoczewski/wulkanizator-go/issues/6) | Customer directory with cars | `type:slice`, `stream:c-customer` | #3 (S-02) |
| S-06 | [#7](https://github.com/tomskoczewski/wulkanizator-go/issues/7) | Tire storage (nice-to-have) | `type:slice`, `stream:d-tire-storage` | #6 (S-05) |

Dependencies are also recorded as a GitHub task-list (`- [ ] Depends on #N`) in each dependent issue's body, so they render as clickable, checkable cross-references in the GitHub UI.

## Open questions

| Roadmap ref | GitHub issue | Title | Blocks |
| --- | --- | --- | --- |
| Open Roadmap Q1 | [#8](https://github.com/tomskoczewski/wulkanizator-go/issues/8) | Missing user stories for remaining MVP flows | roadmap-wide (non-blocking) |
| Open Roadmap Q2 | [#9](https://github.com/tomskoczewski/wulkanizator-go/issues/9) | Are revenue/forecast reports part of the MVP? | S-05, S-06 if answered "yes" |

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

Note: the roadmap's Parked section has an 8th bullet ("Tire storage (S-06) — conditional...") that is not a separate parked item — it's a cross-reference back to S-06's own Unknown (issue #7), so it wasn't migrated as its own issue; the conditional-park note lives in #7's body instead.

## Keeping this in sync

`roadmap.md` is edit-in-place; this file is not automatically regenerated. When `roadmap.md` changes (new slice, status flip to `done`, a parked item promoted back into scope), update the corresponding GitHub issue via `gh issue edit`/`gh issue close` and reflect the change here.
