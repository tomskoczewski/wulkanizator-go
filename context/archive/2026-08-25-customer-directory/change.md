---
change_id: customer-directory
title: Customer directory
status: parked
created: 2026-08-25
updated: 2026-08-25
archived_at: 2026-08-25T00:00:00Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap slice **S-05** (`context/foundation/roadmap.md`, §S-05, now marked `parked`). Prerequisite S-02 is done; parallel with S-04 (also done).
- Tracker: GitHub [#6](https://github.com/tomskoczewski/wulkanizator-go/issues/6) — relabelled `type:slice` → `type:parked`, closed `not planned`. Linear `TOM-10` — same treatment.
- `research.md` was written 2026-08-25 against commit `8a93fe2`, before the park decision. It is thorough (data model, RLS, API/service/schema conventions, search survey, brochure screen extraction, historical decisions) and remains current if this slice is un-parked — re-verify against the codebase at that time rather than re-researching from scratch, per the roadmap's Re-entry trigger for S-05.
- **Archived as `parked`, not `done`.** This folder was moved here by user decision after reviewing `/10x-research`'s findings — the slice was judged not worth building now, not completed. This bends the archive convention (`context/archive/README.md`: "Completed changes") in the same direction S-06 (tire-storage) already bent the roadmap's Parked convention: kept in place rather than deleted, so a future un-park does not re-derive from scratch.
- Two decisions the research flagged as blocking before any future Phase 1 migration: the customer name shape (the roadmap wants "search by last name" but the existing `customers.first_name` column plus the brochure's one-full-name-string mock, including a company as a customer, complicate that), and what to do with the duplicate/orphan `customers` rows already accumulating from S-02's `book_appointment()` inserts (no dedupe, no unique constraint, no DELETE grant anywhere in the schema).
- **The duplicate/orphan-row accumulation is not parked along with this slice** — it keeps happening in production regardless of whether this directory ever ships, since `book_appointment()` still inserts unconditionally. Logged as a standalone lesson, `context/foundation/lessons.md` § "A `security definer` RPC that unconditionally inserts leaves orphan rows on every failed retry" (2026-08-25), so it stays visible independent of this change folder's re-entry.
