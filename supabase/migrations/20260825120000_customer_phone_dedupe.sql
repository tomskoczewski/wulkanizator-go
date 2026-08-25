-- customer-dedupe-on-booking, Phase 1: normalized phone, duplicate merge, unique index
--
-- `book_appointment()` has minted a fresh `customers` row on every booking, with no dedupe of any
-- kind (see `context/foundation/lessons.md` § "A `security definer` RPC that unconditionally
-- inserts…"). This migration introduces the normalization rule as a first-class database object,
-- derives it onto `customers`, collapses the duplicates that already exist, and locks the invariant
-- in with a partial unique index — in that order, because the index cannot be created while
-- duplicates exist and the merge cannot run before the column it groups on exists.
--
-- The dedupe key is derived rather than stored in `phone`: `phone` keeps exactly what the owner
-- typed (display fidelity for the day plan and appointment detail), while `phone_normalized` is a
-- generated column used only for matching.
--
-- The index is partial (`length(phone_normalized) >= 9`) so that junk phones like `"-"` or `"brak"`
-- — which all normalize to the same short string — do not merge unrelated walk-in customers into one
-- row. Phase 2's `on conflict` clause reuses this exact predicate; keep them identical or Postgres
-- cannot infer the index.
--
-- Recompute caveat: `phone_normalized` is a STORED generated column, so it is computed once at
-- insert/update time and never recomputed after `normalize_phone()` changes. If the normalization
-- rule ever needs to widen or change, that is a backfill migration, not a function edit.

-- 1. Normalization function
--
-- Strips every non-digit, then peels prefixes in this order: a leading `00` (international dialing)
-- when more than 11 digits remain, then a leading `48` (Poland's country code) when exactly 11
-- digits remain, then a leading domestic trunk `0` when exactly 10 digits remain. The `48` and
-- trunk-`0` rules are Poland-specific assumptions, matching this project's only market.
--
-- `immutable strict` is required for use in a stored generated column. `set search_path = ''`
-- matches every other function in this schema (`20260814235519_role_and_workshop_scope.sql:41-65`);
-- `regexp_replace` still resolves because `pg_catalog` is implicitly searched even with an empty
-- search_path.

create function public.normalize_phone(p_phone text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  with d as (select regexp_replace(p_phone, '\D', '', 'g') as x),
       s as (select case when length(x) > 11 and left(x, 2) = '00' then substr(x, 3) else x end as x from d)
  select case
    when length(x) = 11 and left(x, 2) = '48' then right(x, 9)
    when length(x) = 10 and left(x, 1) = '0'  then right(x, 9)
    else x
  end
  from s
$$;

revoke execute on function public.normalize_phone(text) from public, anon;
grant execute on function public.normalize_phone(text) to authenticated;

-- 2. Generated column
--
-- No grant changes needed: the existing table-wide `grant select` covers it, and a generated column
-- cannot be written to directly.

alter table public.customers
  add column phone_normalized text generated always as (public.normalize_phone(phone)) stored;

-- 3. Merge existing duplicates onto their oldest row
--
-- Irreversible: this is a real DELETE against live data, run once, here, before the index that
-- prevents future duplicates. Both statements below share an identical `keepers` CTE — within each
-- `(workshop_id, phone_normalized)` group (scoped to `length(phone_normalized) >= 9`, matching the
-- index predicate below), the keeper is the row with the lowest `(created_at, id)`, `id` breaking a
-- `created_at` tie deterministically. The UPDATE repoints every appointment pointing at a
-- non-keeper first (required: `appointments.customer_id` is `on delete restrict`), then the DELETE
-- removes the non-keepers. If the two CTEs ever drift, the UPDATE repoints at a row the DELETE then
-- removes and `on delete restrict` aborts the migration after the column rewrite has already run —
-- keep them literally identical.

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

-- 4. The invariant, enforced by the database
--
-- A partial unique index (not a check-then-insert in plpgsql) so it is race-free by construction —
-- the same reasoning `20260821090000_appointments_and_customers.sql:9-11` used to reject an
-- application-level overlap check. Two different workshops may each hold a customer with the same
-- phone; a below-threshold phone (junk input) is exempt and keeps its own row per booking.

create unique index customers_workshop_phone_normalized_key
  on public.customers (workshop_id, phone_normalized)
  where (length(phone_normalized) >= 9);
