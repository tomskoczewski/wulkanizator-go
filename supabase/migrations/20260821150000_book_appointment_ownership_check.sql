-- S-02 follow-up (impl-review F1): book_appointment() only checked that p_bay_id/p_service_id
-- *exist* (via their FK constraints), never that they belong to the caller's own workshop.
-- Since the function is SECURITY DEFINER and callable directly via PostgREST RPC by any
-- authenticated user, an owner of workshop A could pass workshop B's bay_id and insert a row
-- stamped workshop_id = A but bay_id belonging to B — occupying B's bay with no visibility for B,
-- since RLS hides A's row from B's own SELECTs. This closes the gap the same way the function
-- already re-implements its role/workshop-resolution guard: an explicit existence+ownership check
-- before either insert.
--
-- `create or replace function` with an unchanged signature preserves the existing `execute` grant,
-- so no grant/revoke statements are needed here.

create or replace function public.book_appointment(
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

  if not exists (select 1 from public.bays where id = p_bay_id and workshop_id = v_workshop_id) then
    raise exception 'bay does not belong to this workshop';
  end if;

  if not exists (select 1 from public.services where id = p_service_id and workshop_id = v_workshop_id) then
    raise exception 'service does not belong to this workshop';
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
