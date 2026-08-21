-- S-02 follow-up (impl-review F2): appointments_update_own_workshop's RLS predicate correctly
-- scopes to the caller's own workshop, but the underlying GRANT was table-wide UPDATE — wider than
-- the documented intent ("S-04's whole point is that a worker changes status", per the original
-- migration's own comment). A worker or owner with direct PostgREST access could rewrite
-- bay_id/starts_at/ends_at/service_id/customer_id on any appointment in their workshop, bypassing
-- the slot-suggestion/working-hours validation entirely (the exclusion constraint still blocks a
-- literal double-booking, but nothing else). Narrows the grant to the `status` column only; S-04
-- widens it again if a later status-change flow needs more.

revoke update on public.appointments from authenticated;
grant update (status) on public.appointments to authenticated;
