-- S-01: workshop configuration (bays, services, working hours)
--
-- Adds the three workshop-scoped tables the owner configures on `/ustawienia` and S-02's
-- slot-suggestion algorithm reads. Follows the RLS pattern established in
-- `20260814235519_role_and_workshop_scope.sql` verbatim: enable RLS, grant exactly the operations
-- that have a policy below (Postgres checks table privileges before RLS), scope reads with
-- `current_workshop_id()`, gate writes additionally on `current_user_role() = 'owner'`.
--
-- No INSERT or DELETE policy/grant on `working_hours` — every workshop gets exactly seven rows,
-- seeded once (next migration) and never created through the app. `bays`/`services` get INSERT
-- (the owner adds more) but never DELETE (soft delete via `is_active`).

-- 1. Contact columns on the existing `workshops` stub.

alter table public.workshops
  add column phone text,
  add column address text;

-- 2. Configuration tables

create table public.bays (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  name text not null,
  vehicle_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index bays_workshop_id_idx on public.bays (workshop_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  name text not null,
  duration_min int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint services_duration_min_positive check (duration_min > 0)
);

create index services_workshop_id_idx on public.services (workshop_id);

create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  weekday int not null,
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint working_hours_weekday_range check (weekday between 0 and 6),
  constraint working_hours_workshop_weekday_unique unique (workshop_id, weekday)
);

create index working_hours_workshop_id_idx on public.working_hours (workshop_id);

-- 3. Row level security

alter table public.bays enable row level security;
alter table public.services enable row level security;
alter table public.working_hours enable row level security;

grant select, insert, update on public.bays to authenticated;
grant select, insert, update on public.services to authenticated;
grant select, update on public.working_hours to authenticated;

create policy bays_select_own_workshop on public.bays
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

create policy bays_insert_owner on public.bays
  for insert
  to authenticated
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

create policy bays_update_owner on public.bays
  for update
  to authenticated
  using (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner')
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

create policy services_select_own_workshop on public.services
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

create policy services_insert_owner on public.services
  for insert
  to authenticated
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

create policy services_update_owner on public.services
  for update
  to authenticated
  using (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner')
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');

create policy working_hours_select_own_workshop on public.working_hours
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

create policy working_hours_update_owner on public.working_hours
  for update
  to authenticated
  using (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner')
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');
