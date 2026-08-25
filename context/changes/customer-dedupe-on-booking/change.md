---
change_id: customer-dedupe-on-booking
title: Dedupe customers by phone inside book_appointment()
status: implementing
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

**Problem**: `public.book_appointment()` (`supabase/migrations/20260821150000_book_appointment_ownership_check.sql:42-44`) unconditionally inserts a new `customers` row on every _successful_ call. There is no unique constraint on `(workshop_id, phone)` and no dedupe of any kind, so a repeat walk-in customer gets a fresh row every visit, with no cleanup path since no table in the schema has a DELETE grant. (Corrected 2026-08-25: a client retry after a 409 slot conflict does **not** leak an orphan row — the RPC's two inserts run in one implicit transaction, so a lost race rolls both back together; `supabase/tests/rls_workshop_scope.test.sql:497-526` asserts this and passes. See `context/foundation/lessons.md` § "A `security definer` RPC that unconditionally inserts accumulates a row on every successful call".)

**Planning decisions** (`plan.md`'s Implementation Approach): (1) match key is a derived `phone_normalized` generated column — strips non-digits, then peels a `00` international prefix, a `48` country prefix, and a domestic trunk `0`, so common formats of the same number collapse to one key while `phone` itself displays exactly as typed; (2) the invariant is enforced by a partial unique index (`length(phone_normalized) >= 9`) plus `insert … on conflict do nothing`, not a check-then-insert in plpgsql, so it is race-free by construction; (3) existing duplicates are collapsed in a migration-time merge, not lazily at read time, with every appointment repointed before the loser rows are deleted; (4) oldest `(created_at, id)` always wins — on reuse `first_name` is left untouched, and on merge the oldest row survives.

**Origin**: found during `/10x-research` for S-05 (customer-directory), now parked (`context/foundation/roadmap.md` §S-05, `context/archive/2026-08-25-customer-directory/`). Logged as a standalone lesson: `context/foundation/lessons.md` § "A `security definer` RPC that unconditionally inserts accumulates a row on every successful call" (retitled 2026-08-25; see that entry's "Corrected" line). User confirmed this is worth fixing independent of S-05, since the fix doesn't need any UI.

**Scope — in**: change `book_appointment()`'s insert path to look up an existing `customers` row by `(workshop_id, phone)` before inserting, and reuse it when found. RPC/schema layer only. This is a distinct fix from S-05's eventual "pick an existing customer from a directory" parameter (`p_customer_id`) — phone-based dedupe happens automatically on every booking regardless of whether a directory UI ever exists.

**Scope — out**: no UI, no customer directory, no route/nav changes, no decision on the customer name shape (first/last split vs single name — that's an S-05 concern, not this one's). Does not un-park S-05.

**Relevant background** (avoid re-deriving): `context/archive/2026-08-25-customer-directory/research.md` §3 has the current RPC in full plus the ownership-guard pattern it must keep, §2 has the RLS/migration conventions, §9 has the migration workflow (`db:reset`, `db:test`, `db:types`, `.husky/pre-push` drift check).

**Production audit (2026-08-25, Phase 5.1)**: run read-only against the linked production project (`dqcgpfvlzuvwlmozueaf`) inside `begin; … rollback;`, using `public.normalize_phone()` pasted verbatim from `20260825120000_customer_phone_dedupe.sql`. Result: **0 duplicate `(workshop_id, phone_normalized)` groups, 0 customer rows the merge would delete, 0 appointments it would repoint.** Production currently holds no phone duplicates — the merge migration is a no-op on live data; only the unique index and the RPC's new reuse path change behavior going forward.
