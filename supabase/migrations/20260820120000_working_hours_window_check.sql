-- S-01 follow-up (impl-review F4): constrain the open/close window on `working_hours`.
--
-- The invariant — a closed day has null times, an open day has opens_at < closes_at — previously
-- lived only in `workingHoursUpdateSchema`'s zod refine (`src/lib/schemas/workshop-setup.ts`).
-- `services` already carries `services_duration_min_positive` for the equivalent rule; this closes
-- the same gap for `working_hours`, whose rows S-02's slot-suggestion algorithm reads directly and
-- would otherwise trust unconditionally. No existing row violates this (verified against both local
-- seed data and production before applying).

alter table public.working_hours
  add constraint working_hours_window_valid check (
    (is_closed and opens_at is null and closes_at is null)
    or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at)
  );
