---
change_id: testing-mutation-failure-ui
title: Prove a failed status write is visibly a failed write on the day plan (Risk #1)
status: implemented
created: 2026-09-10
updated: 2026-09-10
archived_at: null
---

## Notes

risk 1    A worker taps a status, the tile updates, the write never landed — the day plan shows a state the database does not have, and the workshop trusts it.
