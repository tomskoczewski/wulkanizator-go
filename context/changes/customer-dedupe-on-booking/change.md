---
change_id: customer-dedupe-on-booking
title: Dedupe customers by phone inside book_appointment()
status: new
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

**Problem**: `public.book_appointment()` (`supabase/migrations/20260821150000_book_appointment_ownership_check.sql:42-44`) unconditionally inserts a new `customers` row on every call. There is no unique constraint on `(workshop_id, phone)` and no dedupe of any kind, so a repeat walk-in customer gets a fresh row every visit — and a client retry after a 409 slot conflict (`NewAppointmentForm.tsx`'s conflict handling) leaks an orphan `customers` row per failed attempt, with no cleanup path since no table in the schema has a DELETE grant.

**Origin**: found during `/10x-research` for S-05 (customer-directory), now parked (`context/foundation/roadmap.md` §S-05, `context/archive/2026-08-25-customer-directory/`). Logged as a standalone lesson: `context/foundation/lessons.md` § "A `security definer` RPC that unconditionally inserts leaves orphan rows on every failed retry". User confirmed this is worth fixing independent of S-05, since the fix doesn't need any UI.

**Scope — in**: change `book_appointment()`'s insert path to look up an existing `customers` row by `(workshop_id, phone)` before inserting, and reuse it when found. RPC/schema layer only. This is a distinct fix from S-05's eventual "pick an existing customer from a directory" parameter (`p_customer_id`) — phone-based dedupe happens automatically on every booking regardless of whether a directory UI ever exists.

**Scope — out**: no UI, no customer directory, no route/nav changes, no decision on the customer name shape (first/last split vs single name — that's an S-05 concern, not this one's). Does not un-park S-05.

**Relevant background** (avoid re-deriving): `context/archive/2026-08-25-customer-directory/research.md` §3 has the current RPC in full plus the ownership-guard pattern it must keep, §2 has the RLS/migration conventions, §9 has the migration workflow (`db:reset`, `db:test`, `db:types`, `.husky/pre-push` drift check).
