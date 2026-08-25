# Dedupe customers by phone inside `book_appointment()` — Implementation Plan

## Overview

`public.book_appointment()` inserts a fresh `public.customers` row on **every** successful booking. A repeat customer therefore accumulates one row per visit, indefinitely, on the application's only appointment write path. There is no unique constraint on `(workshop_id, phone)`, no dedupe of any kind, no `UPDATE` grant on `customers`, and no `DELETE` grant on any table in the schema — so nothing corrects it after the fact.

This change makes the customer insert conditional on a **normalized-phone** match, enforces the invariant with a partial unique index, and merges the duplicates that already exist in the live database. RPC and schema only — no UI, no route changes, no customer-directory work.

## Current State Analysis

### The premise in `change.md` was partly wrong — corrected here

`change.md` and `context/foundation/lessons.md` § _"A `security definer` RPC that unconditionally inserts…"_ both assert that a client retry after a 409 slot conflict **leaks an orphan `customers` row per failed attempt**. That is false, and the repository already proves it:

- `book_appointment()` is a `plpgsql` function; both inserts run inside one implicit transaction. An exclusion violation (`23P01`) on the `appointments` insert rolls the `customers` insert back with it.
- `supabase/tests/rls_workshop_scope.test.sql:497-526` asserts exactly this and passes: _"book_appointment() losing the race leaves no orphan customer row"_.
- The guarantee is stated deliberately in `supabase/migrations/20260821090000_appointments_and_customers.sql:104-108` and again in `src/lib/services/appointments.ts:173-175`.

The **other** half of the description is real and is what this change fixes: every _successful_ booking mints a new customer row. Phase 4 corrects the false clause in both documents rather than letting it propagate — `lessons.md` is re-read by `/10x-frame`, `/10x-research`, `/10x-plan`, `/10x-plan-review` and `/10x-implement`.

### What exists today

| Thing                       | Where                                                       | State                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.customers`          | `20260821090000_appointments_and_customers.sql:25-33`       | `id`, `workshop_id`, `first_name`, `phone text not null`, `created_at`. Index on `workshop_id` only. No unique constraint.                                                             |
| `customers` grants/policies | `:71`, `:74-82`                                             | `grant select, insert` only. `_select_own_workshop` is role-blind (workers read it for the day plan); `_insert_owner` is owner-gated. No `UPDATE`, no `DELETE` anywhere in the schema. |
| `appointments.customer_id`  | `:38`                                                       | `not null references public.customers (id) on delete restrict` — a merge **must** repoint before deleting.                                                                             |
| `book_appointment()`        | `20260821150000_book_appointment_ownership_check.sql:13-59` | Guards workshop, role, bay ownership, service ownership — then inserts customer unconditionally at `:49-51`.                                                                           |
| RPC grant                   | `20260821090000:154-155`                                    | `revoke execute … from public, anon; grant execute … to authenticated`. `create or replace` with an **unchanged signature preserves this grant** (stated at `20260821150000:10-11`).   |
| `phone` validation          | `src/lib/schemas/appointment.ts:18`                         | `z.string().trim().min(1, "Telefon jest wymagany")` — free text. `"600 100 100"`, `"600100100"` and `"+48 600 100 100"` are three different strings today.                             |
| Day-plan read               | `src/lib/services/appointments.ts:216-217`                  | `DAY_PLAN_SELECT` names columns explicitly (`customers(first_name, phone)`), so a new column on `customers` does not change any read.                                                  |
| pgTAP suite                 | `supabase/tests/rls_workshop_scope.test.sql:11`             | `select plan(54)`. **Local-only** — not in `.husky/pre-push`, not in `ci.yml`.                                                                                                         |
| Production                  | `context/deployment/deploy-plan.md` Phases 3-6              | Live cloud Supabase (eu-central, Frankfurt) + Cloudflare Git integration auto-deploying `main` ~93s after push.                                                                        |

### Key Discoveries

- **The signature can stay identical.** `create or replace function public.book_appointment(text, text, uuid, uuid, timestamp, timestamp)` preserves the `execute` grant, so no `grant`/`revoke` statements and no change to `src/lib/services/appointments.ts:196-203`, `src/pages/api/appointments/index.ts`, or `NewAppointmentForm.tsx`. The `Functions.book_appointment` block in `src/db/database.types.ts:301-330` is unchanged.
- **The generated column _does_ change `database.types.ts`.** `customers.Row` (`src/db/database.types.ts:139-145`) gains `phone_normalized`. `npm run db:types` and a committed diff are part of this change; `.husky/pre-push` enforces it (best-effort — it exits 0 silently when the local stack is down).
- **Migrations run as the table owner.** No migration in `supabase/migrations/` sets `force row level security`, so the merge's `DELETE` needs no grant and no policy. The schema-wide "no DELETE grant" posture (`context/archive/2026-08-15-workshop-setup/plan.md:77`) is untouched — `authenticated` still cannot delete a customer.
- **A partial unique index is what makes the junk-phone case safe.** Without it, every walk-in entered as `"-"` or `"brak"` collapses into one shared customer row — and the merge migration would do that collapse irreversibly.
- **Ownership guards are non-negotiable.** They exist because S-02's impl-review found them missing and rated it CRITICAL (`context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:24-36`, F1). `security definer` bypasses RLS, so the function is the only thing standing between a caller and another workshop's rows.

## Desired End State

Booking the same phone number twice — in any common formatting — attaches the second appointment to the **existing** customer row instead of creating a new one, and the database refuses to hold two customers with the same normalized phone inside one workshop. Existing duplicates in the live database are collapsed onto their oldest row with every appointment repointed. Two different workshops may each hold a customer with the same phone. A customer entered with an unusable phone still gets their own row.

Verified by: `npm run db:test` green with the new assertions; booking twice through `/wizyty/nowa` with the same number in different formats produces one customer row and two appointments.

## What We're NOT Doing

- No UI, no customer directory, no nav change. The `"Klienci"` placeholder at `src/layouts/AppShell.astro:22` stays disabled. This does **not** un-park S-05.
- No `p_customer_id` parameter and no signature change. Selecting an existing customer from a directory remains S-05's job; phone dedupe here happens automatically regardless of whether that UI ever ships.
- No decision on the customer name shape (first/last split) — explicitly S-05's.
- No `UPDATE` grant or policy on `customers`. The migration comment at `20260821090000:65-66` still names S-05's edit UI as the owner of that.
- No `DELETE` grant for `authenticated`. The merge deletes as the migration role only.
- No change to `phone` validation in `src/lib/schemas/appointment.ts` and no rewriting of what the owner typed — `phone` keeps the original string; only the derived column is normalized.
- No `cars` table, no search infrastructure, no seed rows.

## Implementation Approach

Four decisions, taken during planning, shape everything below:

1. **Match on digits, display as typed.** A derived `phone_normalized` strips non-digits, then peels a `00` international prefix, a Polish `48` country prefix, and a domestic trunk `0` — so `+48 600 100 100`, `0048600100100`, `0 600 100 100` and `600100100` all collapse to the same key. The `phone` column keeps exactly what the owner entered, so the day plan and appointment detail render unchanged.
2. **The database holds the invariant, not the function body.** A partial unique index plus `insert … on conflict do nothing` is race-free by construction. A check-then-insert in plpgsql loses to two simultaneous requests — the same reasoning `20260821090000:9-11` used to reject an application-level overlap check.
3. **Oldest row wins, always.** On reuse, the existing `first_name` stands and nothing is written to `customers`. On merge, the oldest row survives. A typo at the counter never renames a customer across their appointment history.
4. **Dedupe only above a digit threshold.** The unique index is partial (`length(phone_normalized) >= 9`), so unusable phones each keep their own row instead of merging strangers.

Phases 1 and 2 are separate migration files (one concern per migration, per repo style) but **both must land before any `supabase db push`**. After Phase 1 alone the index exists while the RPC still inserts unconditionally, so a repeat booking raises `23505` — and `bookAppointment()` (`src/lib/services/appointments.ts:205-211`) only special-cases `23P01`, so it would rethrow as a 500. Phase 5's ship sequence exists partly to guarantee production never sees that window.

## Critical Implementation Details

**Generated-column immutability and its one-way door.** A stored generated column requires an `IMMUTABLE` expression, so `normalize_phone()` must be declared `immutable` (and `strict`). Postgres records a dependency: once the column exists, the function cannot be dropped, and a later `create or replace` that changes the normalization rule will **not** recompute already-stored values. Any future change to the rule is a backfill migration, not a function edit — say so in the migration comment.

**`pg_catalog` is implicitly on the search path.** Every function in this schema uses `set search_path = ''` (`20260814235519:41-65` establishes it). `regexp_replace` still resolves, because `pg_catalog` is searched implicitly when not named. Schema-qualify anything in `public` as the existing functions do.

**`on conflict` inference against a partial index.** The `on conflict (…) where …` predicate must match the index's `where` clause exactly, or Postgres cannot infer the index and raises. Keep the two literally identical.

**Ordering inside the Phase 1 migration is load-bearing:** function → generated column → merge → index. The index cannot be created while duplicates exist, and the merge cannot run before the column it groups on exists. One file keeps all four atomic.

---

## Phase 1: Normalized phone, duplicate merge, unique index

### Overview

Introduce the normalization rule as a first-class database object, derive it onto `customers`, collapse the duplicates that already exist, and lock the invariant in — in that order, in one transactional migration.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260825120000_customer_phone_dedupe.sql`

**Intent**: Add `public.normalize_phone()`, derive `customers.phone_normalized` from it, merge existing duplicate customers onto their oldest row, then create the partial unique index that prevents new ones. Lead with a comment explaining why the dedupe key is derived rather than stored in `phone` (display fidelity), why the index is partial (junk phones must not merge strangers), and the recompute caveat from _Critical Implementation Details_.

**Contract**:

- `public.normalize_phone(p_phone text) returns text` — `language sql immutable strict set search_path = ''`. Strips every non-digit, then peels prefixes in this order: a leading `00` (international dialing) when more than 11 digits remain, then a leading `48` when exactly 11 digits remain, then a leading domestic `0` when exactly 10 digits remain. Revoke `execute` from `public, anon` and grant to `authenticated`, matching the convention at `20260814235519:61-65`. Both the `48` and the trunk-`0` rules are Poland-specific assumptions — name them in a comment.

  This exact body was executed against the local Postgres and produces `600100100` for all of `600100100`, `600 100 100`, `600-100-100`, `+48 600 100 100`, `48600100100`, `0048600100100`, `00 48 600 100 100`, `0 600 100 100` and `0600100100`, while leaving `-`, `brak` (both `''`) and a 15-digit junk string untouched:

  ```sql
  with d as (select regexp_replace(p_phone, '\D', '', 'g') as x),
       s as (select case when length(x) > 11 and left(x, 2) = '00' then substr(x, 3) else x end as x from d)
  select case
    when length(x) = 11 and left(x, 2) = '48' then right(x, 9)
    when length(x) = 10 and left(x, 1) = '0'  then right(x, 9)
    else x
  end
  from s
  ```

  The narrower "strip `48` only" rule was rejected during review: it leaves `0048600100100` and `0600100100` as distinct customers, and because the generated column never recomputes (see _Critical Implementation Details_), widening the rule after the fact costs a backfill migration **and** a second irreversible merge on live data. The wider rule must therefore be the one that ships first — and the Phase 5.1 audit must be run with this expression, since it merges strictly more rows than the narrow one would.

- `public.customers.phone_normalized text generated always as (public.normalize_phone(phone)) stored`. No grant changes needed: the existing table-wide `grant select` covers it, and a generated column cannot be written to.
- Merge, in two statements, both scoped to `length(phone_normalized) >= 9`. Within each `(workshop_id, phone_normalized)` group the keeper is the row with the lowest `(created_at, id)` — `id` breaks a `created_at` tie deterministically. First `update public.appointments` to repoint every appointment pointing at a non-keeper (required: the FK is `on delete restrict`), then `delete from public.customers` for the non-keepers.

  This is the irreversible statement in the change, so it is written out rather than described. The `keepers` CTE must be **identical** in both statements — if the two disagree on which row survives, the UPDATE repoints at a row the DELETE then removes and `on delete restrict` aborts the migration after the column rewrite has already run. The shape below was executed against the local Postgres against a fixture holding a 3-row duplicate group, a singleton, two below-threshold rows and a same-phone customer in a second workshop; it left exactly the right five survivors, repointed all seven appointments, and reported zero dangling `customer_id`:

  ```sql
  with keepers as (
    select distinct on (workshop_id, phone_normalized)
           workshop_id, phone_normalized, id as keeper_id
    from public.customers
    where length(phone_normalized) >= 9
    order by workshop_id, phone_normalized, created_at, id
  )
  update public.appointments a
  set customer_id = k.keeper_id
  from public.customers c
  join keepers k on k.workshop_id = c.workshop_id
                and k.phone_normalized = c.phone_normalized
  where a.customer_id = c.id and c.id <> k.keeper_id;

  with keepers as (
    -- identical to the CTE above; do not let the two drift
    select distinct on (workshop_id, phone_normalized)
           workshop_id, phone_normalized, id as keeper_id
    from public.customers
    where length(phone_normalized) >= 9
    order by workshop_id, phone_normalized, created_at, id
  )
  delete from public.customers c
  using keepers k
  where k.workshop_id = c.workshop_id
    and k.phone_normalized = c.phone_normalized
    and c.id <> k.keeper_id;
  ```

- `create unique index customers_workshop_phone_normalized_key on public.customers (workshop_id, phone_normalized) where (length(phone_normalized) >= 9);` — the predicate is reused verbatim in Phase 2's `on conflict` clause.

#### 2. Regenerated database types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new column so `npm run typecheck` checks application code against the real schema.

**Contract**: `npm run db:types` output, committed. `customers.Row` gains `phone_normalized`; the `Insert`/`Update` shapes and the `Functions.book_appointment` block are untouched. Do not hand-edit — the file is generated and `.husky/pre-push` diffs it.

### Success Criteria:

#### Automated Verification:

- `npm run db:reset` applies all migrations cleanly from scratch
- `npm run db:types` produces no further diff after the committed regeneration
- `npm run typecheck` passes
- `npm run lint` passes
- `npm test` passes (no app code changed; this is a regression check)

#### Manual Verification:

- In Studio, a manually inserted pair of `customers` rows with `"600 100 100"` and `"+48600100100"` in one workshop — the second insert is rejected by the unique index
- The same phone inserted into two _different_ workshops is accepted in both
- Two rows with `phone = '-'` in one workshop are both accepted (below the digit threshold)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Conditional customer insert in `book_appointment()`

### Overview

Replace the unconditional insert with a race-free reuse path, preserving the signature, the four ownership guards, and the single-transaction guarantee exactly as they are.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260825120100_book_appointment_dedupe_customer.sql`

**Intent**: `create or replace` the function so a booking reuses an existing customer with a matching normalized phone instead of minting a new row. Comment it with the reason the reuse is `on conflict` rather than a preceding `select` (a check-then-insert loses a concurrent race), and note that the oldest row wins so `first_name` is never overwritten.

**Contract**: Signature unchanged — `(p_first_name text, p_phone text, p_service_id uuid, p_bay_id uuid, p_starts_at timestamp, p_ends_at timestamp) returns public.appointments`, `language plpgsql security definer set search_path = ''`. No `grant`/`revoke` statements: the unchanged signature preserves the existing `execute` grant (`20260821150000:10-11`).

The four guards at `20260821150000:31-47` (workshop resolved, role is `owner`, bay belongs to workshop, service belongs to workshop) are carried over **verbatim and in the same order** — they are the fix for a CRITICAL impl-review finding and are asserted by four existing pgTAP tests.

Only the customer block at `:49-51` changes, to:

```sql
insert into public.customers (workshop_id, first_name, phone)
values (v_workshop_id, p_first_name, p_phone)
on conflict (workshop_id, phone_normalized) where (length(phone_normalized) >= 9)
do nothing
returning id into v_customer_id;

if v_customer_id is null then
  -- Conflict: this workshop already has a customer with this normalized phone. Oldest wins,
  -- so first_name is left as first recorded. `id` breaks a created_at tie deterministically.
  select id into v_customer_id
  from public.customers
  where workshop_id = v_workshop_id
    and phone_normalized = public.normalize_phone(p_phone)
  order by created_at, id
  limit 1;

  if v_customer_id is null then
    raise exception 'customer dedupe failed to resolve a row for the given phone';
  end if;
end if;
```

Three things this shape depends on, each worth a comment in the migration:

- A below-threshold phone is not in the partial index, so no conflict is possible and the insert always succeeds — the fallback branch is simply not entered.
- The defensive `raise` is not dead code. Without it a `null` `v_customer_id` would fail on the `appointments.customer_id not null` constraint with an opaque `23502`, hiding the actual cause.
- The `where` clause must call `public.normalize_phone()` rather than repeat the expression, so it cannot drift from what the generated column stores.

The `appointments` insert at `:53-55` and the `return` are unchanged; both statements stay in one function body, preserving the rollback guarantee that `rls_workshop_scope.test.sql:497-526` asserts.

### Success Criteria:

#### Automated Verification:

- `npm run db:reset` applies cleanly
- `npm run db:test` passes with the existing `plan(54)` — in particular the four ownership/role assertions and the no-orphan assertion at `:497-526`
- `npm run db:types` produces no diff (the signature is unchanged)
- `npm run typecheck`, `npm run lint`, `npm test` all pass

#### Manual Verification:

- Book through `/wizyty/nowa` with `"600 100 100"`, then again with `"+48600100100"` — Studio shows one `customers` row and two `appointments`
- The second booking's day-plan entry shows the **first** booking's name, not the second's
- A booking with `phone = "-"` twice produces two separate customer rows
- Signing in as a worker and calling the RPC still raises `only an owner may book an appointment`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: pgTAP coverage

### Overview

Add the assertions that pin the new behavior, including the cross-workshop case that `security definer` makes a real leak risk.

### Changes Required:

#### 1. RLS isolation suite

**File**: `supabase/tests/rls_workshop_scope.test.sql`

**Intent**: Prove reuse, format-insensitivity, workshop isolation, the junk-phone exception, and that the pre-existing no-orphan guarantee survived the rewrite.

**Contract**: A new block appended after the existing `book_appointment()` cross-workshop tests (`:528-559`), following the file's established patterns — `pg_temp.authenticate_as(uuid)` for role switching, `throws_ok` with an SQLSTATE for a denied insert, and `baseline + N` counting rather than literal counts (`:308-330`, because a developer's local database holds rows created through the app). `it`-style descriptions are English and behavioral.

Assertions to add (7):

1. Owner A books with `"601 200 300"`, then again with `"+48601200300"` on a different slot — the `customers` count rises by exactly 1 across both bookings
2. …and the `appointments` count rises by exactly 2
3. …and both appointments carry the same `customer_id`
4. …and the surviving `first_name` is the one from the _first_ booking
5. Owner B books the same phone (`"601200300"`) in workshop B — B's `customers` count rises by 1 (isolation: the index is scoped per workshop)
6. Owner A books `"-"` twice — the `customers` count rises by 2 (below-threshold phones do not merge)
7. A direct `insert into public.customers` duplicating an existing normalized phone in the same workshop raises `23505`

`select plan(54)` at `:11` becomes `select plan(54 + N)`, where `N` is **not** 7. The 7 items above are the behavioral checks; each of the ~5 new bookings they depend on is itself a `lives_ok` assertion under this file's convention (`:337`, `:361`, `:501`, `:578`), putting the real total around 12. Count the actual `select ok/is/lives_ok/throws_ok` calls in the finished block and set the number from that — criterion 3.1's planned-vs-ran check is the confirmation, not the source.

**Note — two kinds of fixture collision to avoid.** The whole file runs inside one `begin; … rollback;` (`:9`, tail), so every row an earlier block created is live when this block runs:

- **Slot dates** must not collide with the existing fixtures (`2026-09-01` / `05` / `06` / `07`, plus the `+520 weeks` S-04 slot) or the exclusion constraint turns a `lives_ok` into a spurious `23P01`. Follow `:567-576`'s approach — offset by whole weeks so the weekday, and therefore the working-hours window, is unchanged.
- **Phone numbers** must not collide _after normalization_ with a phone an earlier block already booked in the same workshop — this is new with this change, and it is why `"601 200 300"` is used above rather than `"600 100 100"`: owner A already books `'600100100'` at `:338`, so a repeat of it would make assertion 1 count `+0` and pin assertion 4's name to that block's `Jan`. Before adding the block, `grep -n "book_appointment('" supabase/tests/rls_workshop_scope.test.sql` and confirm the chosen number normalizes to something no existing literal does.

### Success Criteria:

#### Automated Verification:

- `npm run db:test` passes with the updated `plan(N)` and no `# Looks like you planned N but ran M` warning
- `npm run db:reset && npm run db:test` passes from a clean database

#### Manual Verification:

- Temporarily reverting Phase 2's migration makes assertions 1-4 fail — confirming they test the new behavior rather than passing vacuously

---

## Phase 4: Correct the documents that describe the old behavior

### Overview

Four documents currently state behavior this change alters, and one states a mechanism that was never true. `lessons.md` in particular is re-read by every downstream skill, so a false claim there propagates into every future change.

### Changes Required:

#### 1. The lessons register

**File**: `context/foundation/lessons.md`

**Intent**: Correct the orphan-on-retry mechanism in place, dated, while preserving the entry's actual rule — which remains sound and is exactly what this change implements.

`lessons.md:3` calls itself an "Append-only register", so this in-place edit is deliberate and bounded: the dated `Corrected 2026-08-25` line is what honours the convention — it records what the entry used to claim, what is actually true, and why, rather than erasing the mistake. Do not silently delete the false clause and leave no trace of it; a reader who saw the original must be able to tell that it was retracted on purpose.

**Contract**: In § _"A `security definer` RPC that unconditionally inserts leaves orphan rows on every failed retry"_ — retitle to drop "orphan rows on every failed retry" (the accumulation is per _successful_ booking); rewrite the **Problem** clause claiming the 409-retry loop "leaks a customer row per attempt", citing `supabase/tests/rls_workshop_scope.test.sql:497-526` as the disproof; append a `- **Corrected 2026-08-25**:` line recording what was revised and why. The **Rule** and **Applies to** lines stand unchanged. Update **Tracked fix** to note the change shipped and what the resolution was.

#### 2. Change notes

**File**: `context/changes/customer-dedupe-on-booking/change.md`

**Intent**: Bring the notes in line with what was actually found and decided.

**Contract**: Correct the orphan-leak claim in **Problem**; record the four planning decisions (normalized-phone match key, partial unique index, merge-in-migration backfill, oldest-row-wins). Set `status: planned` and `updated: 2026-08-25` in the frontmatter.

#### 3. Stale doc comments in code

**File**: `src/lib/services/appointments.ts`

**Intent**: The doc comment at `:173-175` describes the insert as unconditional and frames the transaction as the reason retries are safe. The transaction claim stays true; the "both rows are inserted" claim does not.

**Contract**: Rewrite the second paragraph of `bookAppointment()`'s doc comment to state that the RPC reuses an existing customer with a matching normalized phone and inserts one only when none exists, keeping the rollback sentence. No behavior change — the call at `:196-203` is untouched.

#### 4. Superseded migration comment

**File**: `supabase/migrations/20260821090000_appointments_and_customers.sql`

**Intent**: `:103-112` documents the booking function's insert behavior as current. It is now historical.

**Contract**: Add a one-line pointer above the § 4 comment naming `20260825120100_book_appointment_dedupe_customer.sql` as the current definition. Do not edit the historical text — an applied migration is a record of what ran.

Per `lessons.md` § _"Deleting a symbol means grepping the docs that name it"_: this change adds symbols rather than removing any, but run `grep -rn "book_appointment\|phone_normalized\|normalize_phone" README.md AGENTS.md CLAUDE.md context/` and fold any further hit into this phase.

### Success Criteria:

#### Automated Verification:

- `grep -rn "orphan" context/foundation/lessons.md context/changes/customer-dedupe-on-booking/change.md src/lib/services/appointments.ts` returns only corrected, accurate statements
- `npm run lint` and `npm run format` pass (prettier owns `*.md`)
- `npm test` and `npm run typecheck` pass (comment-only code change)

#### Manual Verification:

- Reading `lessons.md`'s entry cold leaves an accurate picture of both the mechanism and the fix
- No remaining document claims a 409 retry leaks a customer row

---

## Phase 5: Ship sequence

### Overview

The merge deletes rows from the live database irreversibly, and Cloudflare auto-deploys `main` ~93s after push. Per `lessons.md` § _"Merging is deploying"_, the ordering is written out as an explicit numbered sequence rather than assumed.

### Changes Required:

#### 1. Production pre-flight audit

**File**: run against the cloud database — nothing committed

**Intent**: See exactly what the merge will touch before it runs, since there is no undo.

**Contract**: A read-only query, run in the Supabase dashboard SQL editor against the **production** project. It reports, per workshop, the number of `(workshop_id, normalized_phone)` groups holding more than one row, the total rows that would be deleted, and the number of `appointments` that would be repointed. Requires your cloud credentials — this step cannot be automated from the repo.

Do **not** hand-inline the normalization expression. The audit's prediction is what step 8 checks the post-merge counts against, so a second copy of the rule makes any mismatch ambiguous between "the merge misbehaved" and "the audit's expression differed" — and after the review widening (`00` / `48` / trunk-`0`) the expression is long enough for that to be a live risk. Instead, run the audit as one transaction that defines the function from the migration and throws it away again:

```sql
begin;
-- paste the `create function public.normalize_phone(...)` block verbatim
-- from 20260825120000_customer_phone_dedupe.sql
--   … audit selects, written in terms of public.normalize_phone(phone) …
rollback;
```

The `rollback` keeps the step genuinely read-only and leaves the migration free to create the function itself at step 6.

#### 2. The sequence

**Intent**: A single ordered list, executed top to bottom.

**Contract**:

1. Work on a feature branch — never commit these migrations directly to `main`
2. Run the Phase 5.1 audit against production; record the counts in `change.md`
3. `npm run db:reset && npm run db:test` locally — both green
4. `npm run db:types` — no diff beyond what Phase 1 committed
5. `npm run lint && npm run typecheck && npm test && npm run build` — the full CI gate (`.github/workflows/ci.yml`)
6. `npx supabase db push` — **both** migrations reach production before any code does
7. **Confirm both landed, not just the first.** `db push` applies each migration file in its own transaction, so a failure on `20260825120100` leaves production with the index and the merge committed but the _old_ unconditional-insert RPC — the exact `23505` → 500 window this sequence exists to prevent, with no undo for the merge. In the production SQL editor:

   ```sql
   select prosrc like '%on conflict%' as rpc_dedupes
   from pg_proc where proname = 'book_appointment';
   ```

   If this returns `false`, paste the body of `20260825120100_book_appointment_dedupe_customer.sql` into the SQL editor and run it **immediately**, before investigating why the push failed — `create or replace` with an unchanged signature is idempotent and preserves the `execute` grant, so re-running it costs nothing and closes the window.

8. Verify in the production SQL editor that the post-merge counts match the audit's prediction
9. Merge the branch to `main`; Cloudflare rebuilds within ~93s
10. Book a repeat customer through the live URL and confirm one `customers` row

Steps 6 and 9 are the load-bearing pair. Reversing them leaves production running an app whose RPC does not yet dedupe against a schema that does not yet have the index — harmless in this particular change, but the ordering is the standing rule and `wrangler rollback` reverts only the code half.

### Success Criteria:

#### Automated Verification:

- `npm run lint && npm run typecheck && npm test && npm run build` all pass on the feature branch
- `npm run db:reset && npm run db:test` pass from a clean local database
- CI is green on the PR

#### Manual Verification:

- Audit counts recorded in `change.md` before step 6
- Both migrations confirmed applied after `db push` — `book_appointment`'s production body contains the `on conflict` clause
- Post-`db push` production counts match the audit's prediction
- A repeat booking on the live URL reuses the existing customer row
- The day plan and appointment detail screens render unchanged (phone still displays as typed)

---

## Testing Strategy

### Unit Tests

No new Vitest coverage. Nothing in `src/` changes behaviorally — the only application-code edit is a doc comment (Phase 4.3) and a generated file (Phase 1.2). `src/lib/services/appointments.test.ts` hand-stubs the query builder and does not exercise the RPC body; running it is a regression check, not new coverage.

### Integration Tests

pgTAP is the integration layer here, and it is where the whole behavior change is proven — see Phase 3. Note the standing gap from the archived research: **`npm run db:test` is local-only**, absent from both `.husky/pre-push` and `ci.yml`. These assertions run when you run them. Wiring pgTAP into CI is real, worthwhile work and is deliberately out of this change's scope.

### Manual Testing Steps

1. `npm run db:reset && npm run dev`, sign in as an owner
2. Book at `/wizyty/nowa` with name `Jan`, phone `600 100 100`
3. Book again with name `Janek`, phone `+48600100100`, on a different slot
4. Studio → `customers`: one row, `first_name = 'Jan'`, `phone = '600 100 100'`, `phone_normalized = '600100100'`
5. `/dashboard`: both appointments show `Jan` and the phone as originally typed
6. Book twice with phone `-` → two customer rows (below-threshold exception)
7. Sign in as a worker and confirm booking is still refused

## Performance Considerations

Negligible. The `on conflict` path uses the new unique index; the fallback `select` hits the same index. Adding a stored generated column rewrites `customers` once — trivial at MVP row counts, and the audit in Phase 5.1 confirms the actual size before it runs against production.

## Migration Notes

The merge is **irreversible**: rows are deleted and `appointments.customer_id` values are rewritten. There is no undo beyond a Supabase restore. This is why Phase 5.1's audit precedes the push, and why the survivorship rule (oldest `(created_at, id)` wins) is fixed in the plan rather than decided at implementation time.

If the normalization rule ever needs to change, the stored generated column will **not** recompute — that is a backfill migration, not a function edit. Phase 1's migration comment records this.

## References

- Origin and scope: `context/changes/customer-dedupe-on-booking/change.md`
- Lessons register: `context/foundation/lessons.md` § _"A `security definer` RPC that unconditionally inserts…"_, § _"Merging is deploying"_, § _"Deleting a symbol means grepping the docs that name it"_
- Archived research (RPC anatomy §3, RLS conventions §2, testing §8, migration workflow §9): `context/archive/2026-08-25-customer-directory/research.md`
- The CRITICAL finding the ownership guards answer: `context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:24-36`
- Current RPC: `supabase/migrations/20260821150000_book_appointment_ownership_check.sql:13-59`
- No-orphan assertion this change must not break: `supabase/tests/rls_workshop_scope.test.sql:497-526`
- Ship-order precedent: `context/deployment/deploy-plan.md:160-177`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Normalized phone, duplicate merge, unique index

#### Automated

- [x] 1.1 `npm run db:reset` applies all migrations cleanly from scratch — 7a186db
- [x] 1.2 `npm run db:types` produces no further diff after the committed regeneration — 7a186db
- [x] 1.3 `npm run typecheck` passes — 7a186db
- [x] 1.4 `npm run lint` passes — 7a186db
- [x] 1.5 `npm test` passes — 7a186db

#### Manual

- [x] 1.6 Duplicate normalized phone in one workshop is rejected by the unique index — 7a186db
- [x] 1.7 The same phone in two different workshops is accepted in both — 7a186db
- [x] 1.8 Two below-threshold phones in one workshop are both accepted — 7a186db

### Phase 2: Conditional customer insert in `book_appointment()`

#### Automated

- [x] 2.1 `npm run db:reset` applies cleanly — 17f7f45
- [x] 2.2 `npm run db:test` passes with the existing `plan(54)` — 17f7f45
- [x] 2.3 `npm run db:types` produces no diff — 17f7f45
- [x] 2.4 `npm run typecheck`, `npm run lint`, `npm test` all pass — 17f7f45

#### Manual

- [x] 2.5 Two bookings with differently-formatted same phone produce one customer row and two appointments — 17f7f45
- [x] 2.6 The second booking's day-plan entry shows the first booking's name — 17f7f45
- [x] 2.7 Two bookings with phone `-` produce two separate customer rows — 17f7f45
- [x] 2.8 A worker calling the RPC still raises `only an owner may book an appointment` — 17f7f45

### Phase 3: pgTAP coverage

#### Automated

- [x] 3.1 `npm run db:test` passes with the updated `plan(N)` and no planned-vs-ran warning — 22295ed
- [x] 3.2 `npm run db:reset && npm run db:test` passes from a clean database — 22295ed

#### Manual

- [x] 3.3 Reverting Phase 2's migration makes assertions 1-4 fail (non-vacuous) — 22295ed

### Phase 4: Correct the documents that describe the old behavior

#### Automated

- [x] 4.1 `grep -rn "orphan"` across the three documents returns only accurate statements — f91e4d5
- [x] 4.2 `npm run lint` and `npm run format` pass — f91e4d5
- [x] 4.3 `npm test` and `npm run typecheck` pass — f91e4d5

#### Manual

- [x] 4.4 `lessons.md`'s entry reads accurately cold — f91e4d5
- [x] 4.5 No remaining document claims a 409 retry leaks a customer row — f91e4d5

### Phase 5: Ship sequence

#### Automated

- [x] 5.1 `npm run lint && npm run typecheck && npm test && npm run build` pass on the feature branch — 6f0000a
- [x] 5.2 `npm run db:reset && npm run db:test` pass from a clean local database — 6f0000a
- [x] 5.3 CI green on the PR (pushed directly to `main` per the branch-approach decision; run 32858855569 passed) — 6f0000a

#### Manual

- [x] 5.4 Production audit counts recorded in `change.md` before `db push` — 6f0000a
- [x] 5.5 Both migrations confirmed applied after `db push` (`book_appointment` body contains `on conflict`) — 6f0000a
- [x] 5.6 Post-`db push` production counts match the audit's prediction — 6f0000a
- [x] 5.7 A repeat booking on the live URL reuses the existing customer row — 6f0000a
- [x] 5.8 Day plan and appointment detail render unchanged — 6f0000a
