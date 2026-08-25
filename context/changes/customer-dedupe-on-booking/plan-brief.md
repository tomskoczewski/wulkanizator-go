# Dedupe customers by phone inside `book_appointment()` — Plan Brief

> Full plan: `context/changes/customer-dedupe-on-booking/plan.md`

## What & Why

`public.book_appointment()` inserts a fresh `customers` row on **every** successful booking, so a repeat customer accumulates one row per visit — indefinitely, on the app's only appointment write path, with no unique constraint, no `UPDATE` grant, and no `DELETE` grant anywhere in the schema to correct it. This change makes the customer insert conditional on a normalized-phone match and merges the duplicates that already exist in the live database.

**One correction to the change notes.** `change.md` and `lessons.md` both claim a 409-retry leaks an orphan `customers` row per attempt. That is false — the RPC is a plpgsql function, both inserts share one implicit transaction, and `supabase/tests/rls_workshop_scope.test.sql:497-526` already asserts it. The *other* half of the claim — duplicates on every successful booking — is real and is what this fixes. Phase 4 corrects both documents.

## Starting Point

`customers` exists (S-02, `20260821090000`) with `first_name` + `phone text not null`, indexed on `workshop_id` only. `phone` is validated as free text (`min(1)`), so `"600 100 100"` and `"+48600100100"` are different strings today. `appointments.customer_id` is `not null … on delete restrict`. `book_appointment()` guards workshop, role, bay ownership and service ownership — then inserts unconditionally at `20260821150000:49-51`. Production is live on Cloudflare with Git auto-deploy from `main`.

## Desired End State

Booking the same number twice, in any common formatting, attaches the second appointment to the existing customer row. The database refuses to hold two customers with the same normalized phone inside one workshop. Existing duplicates are collapsed onto their oldest row with every appointment repointed. Two workshops may each hold the same phone. A customer entered with an unusable phone still gets their own row, and the day plan still shows the phone exactly as it was typed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Match key | Digits-only, then `00` / `48` / trunk-`0` prefixes peeled; `phone` stored as typed | Catches the realistic walk-in variance (`+48…`, `0048…`, `0 600…`, bare) without rewriting user-entered data or changing what any screen displays. |
| Enforcement | Partial unique index + `insert … on conflict do nothing` | Race-free by construction; a check-then-insert loses to two simultaneous requests, the same reasoning S-02 used to reject an app-level overlap check. |
| Existing duplicates | Merged inside the migration | The unique index cannot be built over duplicates, so the backfill is not optional. |
| Survivorship / name conflict | Oldest `(created_at, id)` wins; `first_name` never overwritten | A typo at the counter must not rename a customer across their whole appointment history. |
| Junk phones | Index is partial — below 9 digits, no dedupe | Otherwise every `"-"` or `"brak"` walk-in collapses into one shared identity, and the merge would do it irreversibly. |
| Materialization | Stored generated column `phone_normalized` | Self-documenting, cannot drift from `phone`, reusable by S-05's search — at the cost of a `database.types.ts` regeneration. |
| RPC signature | Unchanged | `create or replace` preserves the `execute` grant, so no app code, no API route and no form changes. |
| Doc correction | In place in `lessons.md`, dated | That file is re-read by every downstream skill; a false mechanism there propagates into every future change. |

## Scope

**In scope:** `normalize_phone()` + generated column + partial unique index; the duplicate merge; the conditional insert inside `book_appointment()`; 7 pgTAP assertions; correcting four documents that describe the old behavior; the production ship sequence.

**Out of scope:** any UI, the customer directory, nav changes (S-05 stays parked); a `p_customer_id` parameter or any signature change; the customer name shape; `UPDATE`/`DELETE` grants for `authenticated`; tightening phone validation; `cars`, search, seed rows; wiring pgTAP into CI.

## Architecture / Approach

An immutable `public.normalize_phone()` becomes the single definition of "the same number". `customers.phone_normalized` is generated from it and Postgres keeps it in sync. A **partial** unique index on `(workshop_id, phone_normalized) where length >= 9` holds the invariant — the database, not the function body, so concurrency is handled by construction. `book_appointment()` then becomes `insert … on conflict do nothing returning id`, falling back to selecting the oldest matching row when the conflict fires. Below the digit threshold nothing is in the index, so no conflict is possible and the insert always succeeds — the junk-phone exception needs no special-casing in the function.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema | `normalize_phone()`, generated column, duplicate merge, partial unique index, regenerated types | The merge deletes production rows irreversibly; ordering inside the migration is load-bearing |
| 2. RPC | `create or replace book_appointment()` with the conditional insert | Dropping or reordering the four ownership guards — they answer a CRITICAL impl-review finding |
| 3. Tests | 7 behavioral pgTAP checks plus a `lives_ok` per new booking; `plan(54)` → `plan(54 + N)` | New fixtures colliding with existing ones — slots tripping the exclusion constraint, or phones that normalize onto an already-booked customer |
| 4. Docs | Corrections in `lessons.md`, `change.md`, `appointments.ts`, the S-02 migration | Leaving the false orphan claim to propagate through future planning |
| 5. Ship | Production audit → local gate → `db push` → merge | Merging before pushing the schema; `wrangler rollback` reverts only the code half |

**Prerequisites:** Local Supabase stack running (Docker, ~7 GB). Cloud Supabase credentials for the Phase 5.1 audit — that step needs you, it cannot run from the repo. A feature branch; never commit these migrations straight to `main`.

**Estimated effort:** ~2 sessions. Phases 1-3 are one focused sitting; Phases 4-5 are a second, gated on the production audit.

## Open Risks & Assumptions

- **The `00` / `48` / trunk-`0` prefix rules are Poland-specific.** Fine for this product, but they are assumptions baked into stored data, not a general phone-normalization library. The rule was deliberately widened during plan-review rather than after shipping, because the generated column never recomputes.
- **The 9-digit threshold is a judgment call** matching Polish mobile length. Set too high it under-dedupes; too low it merges strangers.
- **The generated column will not recompute** if the normalization rule ever changes — that becomes a backfill migration, not a function edit.
- **`npm run db:test` is local-only**, absent from `.husky/pre-push` and `ci.yml`. Every assertion this change adds runs only when you run it. Wiring pgTAP into CI is real work left undone.
- **The merge has no undo** beyond a Supabase restore. Phase 5.1's audit is the mitigation, and it depends on being actually run.

## Success Criteria (Summary)

- Booking a returning customer twice, in any common phone formatting, produces one `customers` row and two appointments — with the name recorded on the first visit.
- The live database holds no two customers sharing a normalized phone within one workshop, and every appointment still points at a real customer.
- A walk-in with no usable phone number can still be booked, and still gets their own row.
