<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dedupe customers by phone inside `book_appointment()`

- **Plan**: context/changes/customer-dedupe-on-booking/plan.md
- **Scope**: Full plan (Phases 1-5 of 5)
- **Date**: 2026-08-25
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Two parallel sub-agent reviews (plan-drift detection, safety/pattern compliance) plus this session's own automated verification (re-run at every phase boundary, all green, SHAs recorded in `plan.md`'s Progress section) found no drift and no safety issues.

- All 8 planned files (2 migrations, generated types, pgTAP suite, lessons.md, change.md, appointments.ts doc comment, superseded-migration pointer) match their per-phase contracts exactly, including the exact SQL shapes the plan specified verbatim.
- Every "What We're NOT Doing" boundary held: no UPDATE/DELETE grant added for `authenticated`, no `p_customer_id` parameter, no signature change, no `cars` table, `phone` validation untouched.
- SQL injection: clean — no dynamic SQL anywhere in `normalize_phone()` or `book_appointment()`.
- RLS/authz: clean — the four ownership guards in `book_appointment()` carried over verbatim and in order; the merge's UPDATE/DELETE carry no grants, unreachable by `authenticated`.
- Race conditions: clean — `insert ... on conflict do nothing` against a real unique index is the standard race-free upsert pattern; a concurrent second inserter blocks on the index until the first transaction resolves, so the fallback `select` is guaranteed to find the row.
- Idempotency: clean — `normalize_phone()` is correctly `immutable strict`; the RPC's `on conflict ... where (...)` predicate is character-for-character identical to the partial index's predicate, as index inference requires.
- Pattern compliance: clean on both the migration conventions (comment density, `search_path`, grant/revoke shape) and the pgTAP block (baseline-counting via `pg_temp`, `lives_ok`/`throws_ok` conventions).
- Success criteria: all automated checks (lint, typecheck, test, build, `db:reset`, `db:test` at 66/66) passed at every phase boundary; all manual checks confirmed by the user, including production shipping (audit: 0 duplicate groups found; both migrations verified applied; `book_appointment()`'s production body confirmed to contain `on conflict`).

One documented, intentional deviation: `change.md`'s Phase 4 contract literally said `status: planned`, written when the plan predated implementation. The implementer correctly recognized this as stale (regressing status mid-implementation would violate the implement skill's forward-only state machine) and left it as `implementing`/`implemented` instead — flagged to the user via `AskUserQuestion` at the time, not silent drift.

## Findings

### F1 — Merge migration has no explicit transaction wrapping

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped (and arguably not needed)
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260825120000_customer_phone_dedupe.sql:75-101
- **Detail**: The merge's UPDATE and DELETE statements (the two `keepers` CTE blocks) have no explicit `begin`/`commit` in the file; they rely on the Supabase CLI's implicit per-migration-file transaction wrapping, consistent with every sibling migration in this repo. Both CTEs are textually identical (confirmed), so the drift scenario the migration's own comment warns about — the UPDATE repointing at a row the DELETE then removes, aborting on `on delete restrict` — cannot occur as written. A concurrent booking landing between the two statements would be invisible to both, since they only key off rows that existed when the migration ran. No real risk, especially since the production dry-run (Phase 5.1) found 0 duplicate groups before this migration was applied.
- **Fix**: No action needed — noted for completeness only; this matches the existing repo convention and carries no practical risk given the audited production state.
- **Decision**: SKIPPED
