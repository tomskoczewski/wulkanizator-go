-- RLS isolation suite for the F-01 scoping contract. This is the regression net every downstream
-- slice inherits when it copies the workshop-scoped RLS pattern onto a new table.
--
-- Fixture (supabase/seed.sql):
--   owner A  11111111-1111-1111-1111-111111111111  -> workshop "Warsztat A"
--   worker A 33333333-3333-3333-3333-333333333333  -> workshop "Warsztat A" (folded in by the seed)
--   owner B  22222222-2222-2222-2222-222222222222  -> workshop "Warsztat B"

begin;

select plan(26);

-- Switches the session to `authenticated` acting as the given user, for the rest of the
-- transaction. Declared in pg_temp so it never survives past this test file's rollback.
create function pg_temp.authenticate_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
end;
$$;

-- SECURITY INVOKER (the default): each still runs as whatever role authenticate_as() switched to,
-- so RLS still applies. A plain UPDATE can't be used inline as a scalar subquery argument to is()
-- — "WITH ... data-modifying statement must be at the top level" — so the affected row count is
-- captured via GET DIAGNOSTICS instead.

create function pg_temp.try_worker_update_profile() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.profiles set role = 'owner'
  where user_id = '33333333-3333-3333-3333-333333333333';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function pg_temp.try_worker_update_workshop() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.workshops set name = 'Hacked'
  where id = public.current_workshop_id();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- S-01: the same GET DIAGNOSTICS pattern, extended to the three configuration tables. UPDATE's
-- USING clause filters the target set before the statement runs, so a denied UPDATE simply
-- affects zero rows (no exception) — unlike INSERT, where a failing WITH CHECK aborts the
-- statement, so those denials below use throws_ok instead.

create function pg_temp.try_worker_update_bay() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.bays set name = 'Hacked'
  where workshop_id = public.current_workshop_id();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function pg_temp.try_worker_update_service() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.services set name = 'Hacked'
  where workshop_id = public.current_workshop_id();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function pg_temp.try_worker_update_working_hours() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.working_hours set is_closed = true
  where workshop_id = public.current_workshop_id();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Owner A: sees only their own workshop and its two profiles (owner + folded-in worker).

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.workshops),
  1,
  'owner A sees exactly one workshop row'
);

select is(
  (select name from public.workshops limit 1),
  'Warsztat A',
  'owner A''s visible workshop is their own'
);

select is(
  (select count(*)::int from public.profiles),
  2,
  'owner A sees both profiles in their own workshop'
);

select is(
  (select count(*)::int from public.workshops where name = 'Warsztat B'),
  0,
  'owner A sees zero rows from the other workshop''s workshops'
);

select is(
  (select count(*)::int from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'owner A sees zero rows from the other workshop''s profiles'
);

select is(
  public.current_workshop_id(),
  (select workshop_id from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  'current_workshop_id() resolves owner A''s workshop'
);

select is(
  public.current_user_role(),
  'owner'::public.user_role,
  'current_user_role() resolves owner A as owner'
);

-- Seeded-shape assertions (S-01): pins the signup trigger's default catalogue against silent
-- regression. Also proves cross-workshop isolation for the new tables — workshop B is seeded
-- identically, so a leak would inflate these counts.

select is(
  (select count(*)::int from public.bays),
  1,
  'owner A sees exactly one seeded bay'
);

select is(
  (select count(*)::int from public.services),
  6,
  'owner A sees exactly six seeded services'
);

select is(
  (select count(*)::int from public.working_hours),
  7,
  'owner A sees exactly seven seeded working-hours rows'
);

-- Owner B: symmetric cross-workshop check.

select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.workshops where name = 'Warsztat A'),
  0,
  'owner B sees zero rows from workshop A'
);

-- Worker A: sees the same scoped set as their owner, but cannot write to either table.

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.workshops),
  1,
  'worker A sees exactly one workshop row'
);

select is(
  (select count(*)::int from public.profiles),
  2,
  'worker A sees the same profile set as their owner'
);

select is(
  pg_temp.try_worker_update_profile(),
  0,
  'worker A cannot update their own profile row (owner-only UPDATE policy)'
);

select is(
  pg_temp.try_worker_update_workshop(),
  0,
  'worker A cannot update their workshop (owner-only UPDATE policy)'
);

select throws_ok(
  $$ insert into public.profiles (user_id, workshop_id, role)
     values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'worker') $$,
  '42501',
  'permission denied for table profiles',
  'direct INSERT into profiles is rejected for any authenticated user (no INSERT grant)'
);

-- S-01: worker A sees the same seeded configuration as their owner, but cannot write to it.

select is(
  (select count(*)::int from public.bays),
  1,
  'worker A sees the same seeded bay as their owner'
);

select is(
  (select count(*)::int from public.services),
  6,
  'worker A sees the same seeded services as their owner'
);

select is(
  (select count(*)::int from public.working_hours),
  7,
  'worker A sees the same seeded working-hours rows as their owner'
);

select is(
  pg_temp.try_worker_update_bay(),
  0,
  'worker A cannot update a bay (owner-only UPDATE policy)'
);

select is(
  pg_temp.try_worker_update_service(),
  0,
  'worker A cannot update a service (owner-only UPDATE policy)'
);

select is(
  pg_temp.try_worker_update_working_hours(),
  0,
  'worker A cannot update working hours (owner-only UPDATE policy)'
);

select throws_ok(
  $$ insert into public.bays (workshop_id, name) values (public.current_workshop_id(), 'Extra stanowisko') $$,
  '42501',
  null,
  'worker A cannot insert a bay directly (owner-only INSERT policy)'
);

select throws_ok(
  $$ insert into public.services (workshop_id, name, duration_min) values (public.current_workshop_id(), 'Extra usługa', 15) $$,
  '42501',
  null,
  'worker A cannot insert a service directly (owner-only INSERT policy)'
);

select throws_ok(
  $$ delete from public.bays where workshop_id = public.current_workshop_id() $$,
  '42501',
  'permission denied for table bays',
  'direct DELETE from bays is rejected for any authenticated user (no DELETE grant)'
);

-- Anonymous: execute is revoked on the scoping helpers (Phase 1), not merely scoped by RLS.

set local role anon;

select throws_ok(
  $$ select public.current_workshop_id() $$,
  '42501',
  'permission denied for function current_workshop_id',
  'current_workshop_id() is not executable by anon'
);

select * from finish();

rollback;
