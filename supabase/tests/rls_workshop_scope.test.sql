-- RLS isolation suite for the F-01 scoping contract. This is the regression net every downstream
-- slice inherits when it copies the workshop-scoped RLS pattern onto a new table.
--
-- Fixture (supabase/seed.sql):
--   owner A  11111111-1111-1111-1111-111111111111  -> workshop "Warsztat A"
--   worker A 33333333-3333-3333-3333-333333333333  -> workshop "Warsztat A" (folded in by the seed)
--   owner B  22222222-2222-2222-2222-222222222222  -> workshop "Warsztat B"

begin;

select plan(54);

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

-- S-02: worker A is allowed to update an appointment's status (S-04's precondition), unlike the
-- owner-only tables above.

create function pg_temp.try_worker_update_appointment_status() returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.appointments set status = 'in_progress'
  where workshop_id = public.current_workshop_id();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- S-04: the app's compare-and-set update (`.eq("status", from)`), reused across the S-04 block
-- below to prove the worker path works end-to-end and that the slot-release invariant holds.

create function pg_temp.try_cas_update(p_id uuid, p_from public.appointment_status, p_to public.appointment_status) returns int
language plpgsql
as $$
declare
  affected int;
begin
  update public.appointments set status = p_to
  where id = p_id and status = p_from;
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

-- S-02: appointments and customers. book_appointment() inserts both rows in one implicit
-- transaction, so it is the primary path exercised here; direct INSERTs are used only where the
-- point is to prove they're denied (worker) or to build fixture rows for the overlap-guard tests.

-- Owner A books one appointment. This is also the RLS isolation fixture for the next block: if
-- owner B could see it, the counts below would be wrong.

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.book_appointment('Jan', '600100100',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-01 09:00'::timestamp, '2026-09-01 09:45'::timestamp) $$,
  'owner A can book an appointment via book_appointment()'
);

select is(
  (select count(*)::int from public.appointments),
  1,
  'owner A sees exactly one appointment after booking'
);

select is(
  (select count(*)::int from public.customers),
  1,
  'owner A sees exactly one customer after booking'
);

-- Owner B books their own appointment in their own workshop.

select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ select public.book_appointment('Ola', '600200200',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-01 09:00'::timestamp, '2026-09-01 09:45'::timestamp) $$,
  'owner B can book an appointment via book_appointment()'
);

select is(
  (select count(*)::int from public.appointments),
  1,
  'owner B sees exactly one appointment (isolation: not owner A''s)'
);

select is(
  (select count(*)::int from public.customers),
  1,
  'owner B sees exactly one customer (isolation: not owner A''s)'
);

-- Back to owner A: still exactly their own row, proving the isolation holds in both directions.

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.appointments),
  1,
  'owner A cannot select owner B''s appointments (still sees exactly one, their own)'
);

select is(
  (select count(*)::int from public.customers),
  1,
  'owner A cannot select owner B''s customers (still sees exactly one, their own)'
);

-- Worker A: can read and update status in their own workshop, but cannot insert directly or call
-- the owner-gated booking function.

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
     values (
       public.current_workshop_id(),
       (select id from public.customers where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-02 09:00', '2026-09-02 09:45'
     ) $$,
  '42501',
  null,
  'worker A cannot insert an appointment directly (owner-only INSERT policy)'
);

select is(
  (select count(*)::int from public.appointments),
  1,
  'worker A can select the appointment booked in their own workshop'
);

select is(
  pg_temp.try_worker_update_appointment_status(),
  1,
  'worker A can update an appointment''s status in their own workshop'
);

-- impl-review F2: the UPDATE grant is column-restricted to `status` — any other column is denied
-- at the privilege-check layer, before RLS is even consulted (42501, not a zero-row USING filter).

select throws_ok(
  $$ update public.appointments set bay_id = (select id from public.bays where workshop_id = public.current_workshop_id() limit 1)
     where workshop_id = public.current_workshop_id() $$,
  '42501',
  null,
  'worker A cannot update a column other than status (column-level UPDATE grant)'
);

select throws_ok(
  $$ select public.book_appointment('Ktos', '600300300',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-03 09:00'::timestamp, '2026-09-03 09:45'::timestamp) $$,
  'P0001',
  'only an owner may book an appointment',
  'worker A cannot call book_appointment() (in-function role check, since SECURITY DEFINER bypasses RLS)'
);

-- Owner A: the overlap guard itself.

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
     values (
       public.current_workshop_id(),
       (select id from public.customers where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-01 09:30', '2026-09-01 10:15'
     ) $$,
  '23P01',
  null,
  'an appointment overlapping an existing one on the same bay is rejected by the exclusion constraint'
);

select lives_ok(
  $$ insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
     values (
       public.current_workshop_id(),
       (select id from public.customers where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-01 09:45', '2026-09-01 10:30'
     ) $$,
  'a back-to-back appointment starting exactly when another ends is accepted (the ''[)'' bound)'
);

select lives_ok(
  $$ update public.appointments set status = 'no_show'
     where workshop_id = public.current_workshop_id() and starts_at = '2026-09-01 09:00'::timestamp $$,
  'the first appointment can be marked no_show'
);

select lives_ok(
  $$ insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
     values (
       public.current_workshop_id(),
       (select id from public.customers where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-01 09:00', '2026-09-01 09:45'
     ) $$,
  'overlapping a no_show appointment on the same bay is accepted (the partial-index regression test)'
);

-- book_appointment() losing the race leaves no orphan customer: the second call for the same bay
-- and slot must raise 23P01 AND leave the customers count unchanged, proving the rollback covers
-- both inserts made inside the function body.

select lives_ok(
  $$ select public.book_appointment('Race1', '600400400',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-05 09:00'::timestamp, '2026-09-05 09:45'::timestamp) $$,
  'first book_appointment() call for a fresh slot succeeds'
);

create temporary table pg_temp.customer_count_before as
  select count(*)::int as n from public.customers;

select throws_ok(
  $$ select public.book_appointment('Race2', '600500500',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-05 09:00'::timestamp, '2026-09-05 09:45'::timestamp) $$,
  '23P01',
  null,
  'a second book_appointment() call for the same bay and slot loses the race'
);

select is(
  (select count(*)::int from public.customers),
  (select n from pg_temp.customer_count_before),
  'book_appointment() losing the race leaves no orphan customer row'
);

-- impl-review F1: book_appointment() must reject a bay/service belonging to a *different*
-- workshop, not merely check that the row exists somewhere. Capture workshop B's own ids while
-- authenticated as owner B (RLS-scoped), then attempt to use them as owner A.

select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');

create temporary table pg_temp.workshop_b_refs as
  select
    (select id from public.bays where workshop_id = public.current_workshop_id() limit 1) as bay_id,
    (select id from public.services where workshop_id = public.current_workshop_id() limit 1) as service_id;

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ select public.book_appointment('Cross1', '600666777',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select bay_id from pg_temp.workshop_b_refs),
       '2026-09-06 09:00'::timestamp, '2026-09-06 09:45'::timestamp) $$,
  'P0001',
  'bay does not belong to this workshop',
  'owner A cannot book_appointment() using workshop B''s bay_id'
);

select throws_ok(
  $$ select public.book_appointment('Cross2', '600777888',
       (select service_id from pg_temp.workshop_b_refs),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-07 09:00'::timestamp, '2026-09-07 09:45'::timestamp) $$,
  'P0001',
  'service does not belong to this workshop',
  'owner A cannot book_appointment() using workshop B''s service_id'
);

-- S-04: worker walks a fresh appointment through the compare-and-set flow the app's
-- changeAppointmentStatus() service uses, and the slot-release/re-occupation invariant it depends
-- on (FR-005's slot-release half).

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.book_appointment('Ela', '600800800',
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-08 09:00'::timestamp, '2026-09-08 09:45'::timestamp) $$,
  'owner A books the S-04 fixture appointment'
);

create temporary table pg_temp.s04_appointment as
  select id from public.appointments
  where workshop_id = public.current_workshop_id() and starts_at = '2026-09-08 09:00'::timestamp;

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  pg_temp.try_cas_update((select id from pg_temp.s04_appointment), 'waiting', 'in_progress'),
  1,
  'worker A moves the S-04 appointment waiting -> in_progress via compare-and-set'
);

select is(
  pg_temp.try_cas_update((select id from pg_temp.s04_appointment), 'in_progress', 'done'),
  1,
  'worker A moves the S-04 appointment in_progress -> done via compare-and-set'
);

select is(
  pg_temp.try_cas_update((select id from pg_temp.s04_appointment), 'done', 'no_show'),
  1,
  'worker A marks the S-04 appointment no_show, releasing its bay window'
);

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
     values (
       public.current_workshop_id(),
       (select id from public.customers where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.services where workshop_id = public.current_workshop_id() limit 1),
       (select id from public.bays where workshop_id = public.current_workshop_id() limit 1),
       '2026-09-08 09:00', '2026-09-08 09:45'
     ) $$,
  'the S-04 no_show window accepts a new overlapping appointment (slot released)'
);

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ update public.appointments set status = 'waiting'
     where id = (select id from pg_temp.s04_appointment) and status = 'no_show' $$,
  '23P01',
  null,
  'reversing the S-04 no_show into its now re-occupied window fails with the exclusion constraint'
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
