-- S-02: appointments and customers
--
-- Adds the two domain tables this slice writes: `customers` (walk-in minimum: first name + phone)
-- and `appointments` (one row per booked visit). Follows the RLS pattern established in
-- `20260814235519_role_and_workshop_scope.sql` verbatim: enable RLS, grant exactly the operations
-- that have a policy below, scope reads with `current_workshop_id()`, gate writes additionally on
-- `current_user_role() = 'owner'` where the PRD requires it.
--
-- The correctness guarantee for "no two appointments on the same bay at the same time" lives here,
-- in Postgres, as an exclusion constraint — not in application code, since a check-then-insert in
-- the API loses to two simultaneous requests.

create extension if not exists btree_gist;

-- 1. Status enum
--
-- All five values defined now even though this slice only ever inserts 'waiting': S-04 owns the
-- remaining transitions and the values are already colour-mapped in
-- context/foundation/design-system.md, so defining the type once avoids a later `alter type`.

create type public.appointment_status as enum ('waiting', 'in_progress', 'done', 'no_show', 'cancelled');

-- 2. Tables

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  first_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create index customers_workshop_id_idx on public.customers (workshop_id);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  bay_id uuid not null references public.bays (id) on delete restrict,
  starts_at timestamp not null,
  ends_at timestamp not null,
  status public.appointment_status not null default 'waiting',
  created_at timestamptz not null default now(),
  constraint appointments_ends_after_starts check (ends_at > starts_at)
);

create index appointments_workshop_id_starts_at_idx on public.appointments (workshop_id, starts_at);

-- The overlap guard: no two live appointments may occupy the same bay at overlapping times.
-- `tsrange` (not `tstzrange`) because starts_at/ends_at are naive wall-clock. The `'[)'` bound is
-- what makes back-to-back appointments legal (a 10:00-11:00 job sits directly against an
-- 11:00-12:00 job on the same bay). The partial `where` is what makes a `no_show` release its slot,
-- implementing S-04's "no-show releases the slot" for free while keeping the row in history.

alter table public.appointments
  add constraint appointments_no_overlap_per_bay
  exclude using gist (
    bay_id with =,
    tsrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'));

-- 3. Row level security
--
-- No DELETE grant or policy on either table, matching the soft-delete posture S-01 established.
-- `customers` gets no UPDATE grant either — that lands with S-05's edit UI.

alter table public.customers enable row level security;
alter table public.appointments enable row level security;

grant select, insert on public.customers to authenticated;
grant select, insert, update on public.appointments to authenticated;

create policy customers_select_own_workshop on public.customers
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

create policy customers_insert_owner on public.customers
  for insert
  to authenticated
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

-- Both roles can read appointments: workers need this for S-03/S-04.
create policy appointments_select_own_workshop on public.appointments
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

-- Only the owner adds a visit (FR-004, PRD Access Control).
create policy appointments_insert_owner on public.appointments
  for insert
  to authenticated
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

-- Both roles can update: S-04's whole point is that a worker changes status.
create policy appointments_update_own_workshop on public.appointments
  for update
  to authenticated
  using (workshop_id = public.current_workshop_id())
  with check (workshop_id = public.current_workshop_id());

-- 4. Booking function
--
-- Superseded: this is the original definition; the current one is
-- `supabase/migrations/20260825120100_book_appointment_dedupe_customer.sql`, which reuses an
-- existing customer by normalized phone instead of inserting unconditionally. Left as-is below —
-- an applied migration is a record of what ran.
--
-- Inserts the customer row and the appointment row in one function body, so Postgres runs both in
-- a single implicit transaction: an exclusion violation on the second insert rolls the first back,
-- and a lost race can never leave an orphan customer behind. This is what makes the client's
-- 409-retry loop safe to repeat.
--
-- SECURITY DEFINER bypasses RLS, so the function re-implements the guard itself as its first
-- statements rather than relying on the policies above. workshop_id is stamped on both inserts from
-- the resolved local, never from a parameter, so a caller cannot book into another workshop.

create function public.book_appointment(
  p_first_name text,
  p_phone text,
  p_service_id uuid,
  p_bay_id uuid,
  p_starts_at timestamp,
  p_ends_at timestamp
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workshop_id uuid;
  v_customer_id uuid;
  v_appointment public.appointments;
begin
  v_workshop_id := public.current_workshop_id();

  if v_workshop_id is null then
    raise exception 'no workshop resolved for current user';
  end if;

  if public.current_user_role() <> 'owner' then
    raise exception 'only an owner may book an appointment';
  end if;

  insert into public.customers (workshop_id, first_name, phone)
  values (v_workshop_id, p_first_name, p_phone)
  returning id into v_customer_id;

  insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
  values (v_workshop_id, v_customer_id, p_service_id, p_bay_id, p_starts_at, p_ends_at)
  returning * into v_appointment;

  return v_appointment;
end;
$$;

revoke execute on function public.book_appointment(text, text, uuid, uuid, timestamp, timestamp) from public, anon;
grant execute on function public.book_appointment(text, text, uuid, uuid, timestamp, timestamp) to authenticated;
