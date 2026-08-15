-- S-01: default seeding for workshop configuration
--
-- Gives every workshop a reviewable starting point instead of an empty one: six services, one
-- bay, seven weekday working-hours rows. `seed_workshop_defaults()` is the single definition of
-- that default catalogue, called both from the signup trigger (new workshops) and once below as a
-- backfill (workshops that already existed before this migration).
--
-- Idempotency matters here for two reasons: `handle_new_user()` runs on every `auth.users` INSERT
-- for every deployed Worker version (see README "Trigger kill-switch"), so the seeding inserts
-- must be safe to call more than once against the same workshop; and the backfill statement below
-- calls it for every existing workshop unconditionally, relying on that same safety.

create function public.seed_workshop_defaults(p_workshop_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.services (workshop_id, name, duration_min)
  select p_workshop_id, v.name, v.duration_min
  from (
    values
      ('Wymiana kół', 30),
      ('Wymiana opon', 40),
      ('Wymiana + wyważanie', 45),
      ('Wyważanie', 20),
      ('Naprawa ogumienia', 20),
      ('Utylizacja', 10)
  ) as v (name, duration_min)
  where not exists (
    select 1 from public.services where workshop_id = p_workshop_id
  );

  insert into public.bays (workshop_id, name, vehicle_type)
  select p_workshop_id, 'Stanowisko 1', 'osobowe'
  where not exists (
    select 1 from public.bays where workshop_id = p_workshop_id
  );

  -- weekday follows Postgres `dow`: 0 = Sunday. `on conflict` relies on
  -- working_hours_workshop_weekday_unique from the previous migration.
  insert into public.working_hours (workshop_id, weekday, opens_at, closes_at, is_closed)
  select p_workshop_id, v.weekday, v.opens_at, v.closes_at, v.is_closed
  from (
    values
      (0, null::time, null::time, true),
      (1, '07:00'::time, '18:00'::time, false),
      (2, '07:00'::time, '18:00'::time, false),
      (3, '07:00'::time, '18:00'::time, false),
      (4, '07:00'::time, '18:00'::time, false),
      (5, '07:00'::time, '18:00'::time, false),
      (6, '08:00'::time, '14:00'::time, false)
  ) as v (weekday, opens_at, closes_at, is_closed)
  on conflict (workshop_id, weekday) do nothing;
end;
$$;

revoke execute on function public.seed_workshop_defaults(uuid) from public, anon, authenticated;

-- Redefine the signup trigger function to seed defaults after provisioning. Signature, security
-- definer, and search_path are unchanged, so `create or replace` leaves `on_auth_user_created`
-- bound to this new body without recreating the trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workshop_id uuid;
begin
  insert into public.workshops (name)
  values (coalesce(split_part(new.email, '@', 1), 'Nowy warsztat'))
  returning id into new_workshop_id;

  insert into public.profiles (user_id, workshop_id, role)
  values (new.id, new_workshop_id, 'owner');

  perform public.seed_workshop_defaults(new_workshop_id);

  return new;
end;
$$;

-- Backfill: give every workshop that existed before this migration the same defaults a new
-- signup gets. Runs as the migration role, so RLS and table grants don't apply. Safe to re-run —
-- seed_workshop_defaults() is idempotent.
select public.seed_workshop_defaults(id) from public.workshops;
