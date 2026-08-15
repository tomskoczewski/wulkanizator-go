---
change_id: role-and-workshop-scope
title: "User role and workshop scope (RLS + route-guard)"
status: implemented
created: 2026-08-15
updated: 2026-08-15
roadmap_ref: F-01
prd_refs:
  - "Access Control (two roles)"
  - "NFR (GDPR baseline)"
  - "Non-Goals (one account = one workshop)"
---

# Change: User role and workshop scope

Foundation change F-01 from `context/foundation/roadmap.md`.

Establishes the `profiles` table (`user_id`, `workshop_id`, `role: owner|worker`), the
workshop-scoped RLS pattern that every downstream domain table inherits, and a role-aware
`src/middleware.ts`.

## Unlocks

- **S-01** `workshop-setup` — needs an owner with a `workshop_id`
- **S-04** `worker-status-changes` — needs the `worker` role
- **S-02 – S-06** — every domain table inherits the RLS pattern defined here

## Artifacts

- `plan-brief.md` — two-page summary (read first)
- `plan.md` — full implementation contract
- `reviews/plan-review.md` — pre-code readiness review (9 findings, all fixed in the plan)
