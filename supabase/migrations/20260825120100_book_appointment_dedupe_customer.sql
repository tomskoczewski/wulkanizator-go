-- customer-dedupe-on-booking, Phase 2: conditional customer insert in book_appointment()
--
-- Replaces the unconditional customer insert with a race-free reuse path: `insert … on conflict
-- (workshop_id, phone_normalized) where (length(phone_normalized) >= 9) do nothing` against the
-- partial unique index from 20260825120000_customer_phone_dedupe.sql. The `on conflict` clause's
-- predicate is copied verbatim from that index — Postgres cannot infer a partial index unless the
-- two match exactly.
--
-- `on conflict` rather than a preceding `select … then insert`: a check-then-insert loses a
-- concurrent race between two requests for the same phone (the same reasoning
-- 20260821090000_appointments_and_customers.sql:9-11 used to reject an application-level overlap
-- check). The database enforces the invariant; this function just reacts to it.
--
-- Oldest row wins: on conflict, `v_customer_id` is resolved by the earliest `(created_at, id)`
-- match, so a repeat booking never overwrites `first_name` from an earlier visit.
--
-- Signature is unchanged, so `create or replace` preserves the existing `execute` grant
-- (20260821150000_book_appointment_ownership_check.sql:10-11) — no grant/revoke statements needed.
-- The four ownership guards (workshop resolved, role is owner, bay/service belong to the workshop)
-- are carried over verbatim and in the same order; they are the fix for a CRITICAL impl-review
-- finding (context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:24-36) and
-- are asserted by existing pgTAP tests.

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
  on conflict (workshop_id, phone_normalized) where (length(phone_normalized) >= 9)
  do nothing
  returning id into v_customer_id;

  if v_customer_id is null then
    -- Conflict: this workshop already has a customer with this normalized phone. Oldest wins, so
    -- first_name is left as first recorded. `id` breaks a created_at tie deterministically. A
    -- below-threshold phone is never in the partial index, so this branch is only reachable when
    -- the insert actually lost a conflict.
    select id into v_customer_id
    from public.customers
    where workshop_id = v_workshop_id
      and phone_normalized = public.normalize_phone(p_phone)
    order by created_at, id
    limit 1;

    if v_customer_id is null then
      -- Defensive: should be unreachable given the conflict just occurred. Without this raise, a
      -- null v_customer_id would instead fail the appointments.customer_id not null constraint with
      -- an opaque 23502, hiding the actual cause.
      raise exception 'customer dedupe failed to resolve a row for the given phone';
    end if;
  end if;

  insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
  values (v_workshop_id, v_customer_id, p_service_id, p_bay_id, p_starts_at, p_ends_at)
  returning * into v_appointment;

  return v_appointment;
end;
$$;
