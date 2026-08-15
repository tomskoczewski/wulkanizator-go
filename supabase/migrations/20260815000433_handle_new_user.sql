-- F-01: provisioning trigger
--
-- Creates a workshop and an owner profile atomically whenever a row lands in `auth.users`, so the
-- orphan state (auth user with no profile) is structurally impossible rather than merely unlikely.
-- This fires on every signup path regardless of whether email confirmation is enabled, because it
-- runs at INSERT time, not at first-session time.
--
-- The trigger name `on_auth_user_created` is load-bearing: it is what the README kill-switch
-- snippet (`drop trigger if exists on_auth_user_created on auth.users;`) drops if the function ever
-- starts rejecting signups in production.

create function public.handle_new_user()
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

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
