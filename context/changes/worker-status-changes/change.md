---
change_id: worker-status-changes
title: Worker status changes
status: impl_reviewed
created: 2026-08-21
updated: 2026-08-24
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **2026-08-25 — manual criterion 4.7 re-verified.** The implementation review found (F1) that the
  day-plan stretched-link overlay was painted *under* the card content, so tapping the card body
  reached a non-interactive `div` and never navigated — only the 12px padding ring did. Progress row
  4.7 had therefore been ticked against broken behaviour at `d0c200c`. Fixed in `d61b537` and
  re-verified by hand afterwards: tapping the customer name opens `/wizyty/<id>`. The row's `—
  d0c200c` suffix is left as-is because `/10x-implement` owns that suffix; this note is the
  correction.
