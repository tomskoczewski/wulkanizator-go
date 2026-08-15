-- F-01: user role and workshop scope
--
-- Establishes the foundation every downstream table inherits: a `workshops` stub, a `profiles`
-- table binding one auth user to exactly one workshop and one role, a pair of SECURITY DEFINER
-- helpers that let RLS policies answer "which workshop / role is this user?" in one line, and the
-- per-operation RLS policies on both tables. Provisioning (the trigger that guarantees no orphan
-- auth users) lands in the next migration.

-- 1. Role enum

create type public.user_role as enum ('owner', 'worker');

-- 2. Tables
--
-- `workshops` before `profiles` — the FK requires it. Both tables (and their RLS enablement) must
-- exist before the helper functions below, and the helpers must exist before the policies that
-- call them.

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  role public.user_role not null default 'owner',
  created_at timestamptz not null default now()
);

create index profiles_workshop_id_idx on public.profiles (workshop_id);

-- 3. Scope-resolution helpers
--
-- `security definer` bypasses RLS, which is required: without it, `profiles`' own SELECT policy
-- calling this function would recurse into itself. `set search_path = ''` closes the
-- privilege-escalation vector a mutable search_path would otherwise open, so every reference below
-- is schema-qualified.

create function public.current_workshop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select workshop_id from public.profiles where user_id = auth.uid();
$$;

create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

revoke execute on function public.current_workshop_id() from public, anon;
grant execute on function public.current_workshop_id() to authenticated;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- 4. Row level security
--
-- No INSERT or DELETE policy on either table: provisioning is the trigger's job (next migration)
-- and it runs as SECURITY DEFINER, bypassing RLS entirely. Absent policies mean denied, which is
-- the correct default for operations only the trigger should perform.

alter table public.workshops enable row level security;
alter table public.profiles enable row level security;

-- Table-level grants mirror exactly the operations that have a policy below: Postgres checks
-- table privileges before RLS, so an operation with no grant is denied before RLS is even
-- consulted. No INSERT or DELETE grant, for the same reason there is no INSERT or DELETE policy.
grant select, update on public.workshops to authenticated;
grant select, update on public.profiles to authenticated;

create policy workshops_select_own on public.workshops
  for select
  to authenticated
  using (id = public.current_workshop_id());

create policy workshops_update_owner on public.workshops
  for update
  to authenticated
  using (id = public.current_workshop_id() and public.current_user_role() = 'owner')
  with check (id = public.current_workshop_id() and public.current_user_role() = 'owner');

create policy profiles_select_own_workshop on public.profiles
  for select
  to authenticated
  using (workshop_id = public.current_workshop_id());

create policy profiles_update_owner on public.profiles
  for update
  to authenticated
  using (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner')
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');
