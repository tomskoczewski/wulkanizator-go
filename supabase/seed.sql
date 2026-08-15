-- Local-stack fixture: two workshops, one of which has both an owner and a worker, so both the
-- cross-workshop and the cross-role dimension of RLS are covered by the isolation suite in
-- supabase/tests/rls_workshop_scope.test.sql.
--
-- pgTAP lives here, not in a migration: seed.sql runs on `db reset` but is never shipped by
-- `db push`, so the extension stays out of production. There is no "test-only migration"
-- directory in Supabase.
create extension if not exists pgtap with schema extensions;

-- Three auth users. handle_new_user() (previous migration) fires once per row inserted here and
-- creates one workshop + one owner profile per user before the next statement runs. The UPDATE
-- block below therefore folds user 3 into user 1's workshop and demotes them to worker — it must
-- NOT insert into profiles, which would violate the user_id primary key the trigger already
-- claimed. Every user also needs an `auth.identities` row: without it GoTrue's password grant
-- cannot resolve the account, and the fixture user silently cannot sign in.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated', 'owner-a@example.com',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated', 'owner-b@example.com',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated', 'worker-a@example.com',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(), now(), now()
from auth.users u
where u.id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

-- Fold user 3 into user 1's workshop as a worker.
update public.profiles
set workshop_id = (
      select workshop_id from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    role = 'worker'
where user_id = '33333333-3333-3333-3333-333333333333';

-- Drop the now-unused third workshop (the one the trigger created for user 3 before the fold above).
delete from public.workshops
where id not in (select workshop_id from public.profiles);

-- Fixture-friendly names.
update public.workshops set name = 'Warsztat A'
where id = (select workshop_id from public.profiles where user_id = '11111111-1111-1111-1111-111111111111');

update public.workshops set name = 'Warsztat B'
where id = (select workshop_id from public.profiles where user_id = '22222222-2222-2222-2222-222222222222');
