import { describe, expect, it, vi } from "vitest";
import { changeAppointmentStatus } from "./appointments";
import type { TypedSupabaseClient } from "@/lib/supabase";

/**
 * `changeAppointmentStatus` is a thin mapper over two query chains, and its whole job is deciding
 * which `StatusChangeOutcome` each database result means. Stubbing the builder is enough to pin
 * that mapping — the database's own behaviour is covered by the pgTAP block in
 * `supabase/tests/rls_workshop_scope.test.sql`.
 *
 *   update chain: .from().update().eq().eq().select().maybeSingle()
 *   read chain:   .from().select().eq().maybeSingle()
 */

interface Result {
  data: unknown;
  error: unknown;
}

const OK_ROW = {
  id: "appt-1",
  status: "in_progress",
  starts_at: "2026-09-01T09:00:00",
  ends_at: "2026-09-01T09:30:00",
  customers: { first_name: "Jan", phone: "500600700" },
  services: { name: "Wymiana opon", duration_min: 30 },
  bays: { name: "Stanowisko 1" },
};

/** Both chains are pure `.then`-less builders that only resolve at `maybeSingle()`. */
function chain(result: Result) {
  const link = {
    eq: () => link,
    select: () => link,
    maybeSingle: () => Promise.resolve(result),
  };
  return link;
}

function stubSupabase(updateResult: Result, readResult?: Result) {
  return {
    from: () => ({
      update: () => chain(updateResult),
      // Only reached on the zero-row path, where the service re-reads `status` directly.
      select: () => chain(readResult ?? { data: null, error: null }),
    }),
  } as unknown as TypedSupabaseClient;
}

describe("changeAppointmentStatus", () => {
  it("returns `illegal` for a no-op transition without touching the database", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as TypedSupabaseClient;

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "done", from: "done" });

    expect(outcome).toEqual({ status: "illegal" });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns `illegal` for any transition touching `cancelled`", async () => {
    const supabase = stubSupabase({ data: OK_ROW, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", {
      status: "waiting",
      // `cancelled` is barred by the request schema, so this can only arrive from a non-HTTP caller.
      from: "cancelled" as "waiting",
    });

    expect(outcome).toEqual({ status: "illegal" });
  });

  it("returns `updated` with the mapped entry when the compare-and-set matches a row", async () => {
    const supabase = stubSupabase({ data: OK_ROW, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" });

    expect(outcome).toMatchObject({ status: "updated", current: "in_progress" });
    expect(outcome).toHaveProperty("entry.id", "appt-1");
    expect(outcome).toHaveProperty("entry.status", "in_progress");
    expect(outcome).toHaveProperty("entry.customerFirstName", "Jan");
  });

  it("still returns `updated` with a null entry when the row's joins are incomplete", async () => {
    // The UPDATE has already committed here — reporting a failure would desync the client from the
    // database, so the outcome stays a success and only `entry` degrades.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const supabase = stubSupabase({ data: { ...OK_ROW, services: null }, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" });

    expect(outcome).toEqual({ status: "updated", current: "in_progress", entry: null });
    warn.mockRestore();
  });

  it("returns `slot_taken` when the exclusion constraint re-engages (23P01)", async () => {
    const supabase = stubSupabase({ data: null, error: { code: "23P01" } });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "waiting", from: "no_show" });

    expect(outcome).toEqual({ status: "slot_taken" });
  });

  it("rethrows an unexpected database error rather than mapping it to an outcome", async () => {
    const supabase = stubSupabase({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(
      changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("returns `stale` carrying the row's true status when it moved underneath the caller", async () => {
    const supabase = stubSupabase({ data: null, error: null }, { data: { status: "done" }, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" });

    expect(outcome).toEqual({ status: "stale", current: "done" });
  });

  it("treats a row already at the requested status as an idempotent success, not a conflict", async () => {
    // Two workers tapping the same button: the second one's CAS matches nothing, but the end state
    // they asked for holds — surfacing that as a 409 would show a failure for a successful action.
    const supabase = stubSupabase({ data: null, error: null }, { data: { status: "in_progress" }, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" });

    expect(outcome).toEqual({ status: "updated", current: "in_progress", entry: null });
  });

  it("returns `not_found` when the row is invisible to the caller", async () => {
    const supabase = stubSupabase({ data: null, error: null }, { data: null, error: null });

    const outcome = await changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" });

    expect(outcome).toEqual({ status: "not_found" });
  });

  it("does not report a `stale` row as `not_found` when the re-read itself fails", async () => {
    const supabase = stubSupabase({ data: null, error: null }, { data: null, error: { code: "08006" } });

    await expect(
      changeAppointmentStatus(supabase, "appt-1", { status: "in_progress", from: "waiting" }),
    ).rejects.toMatchObject({ code: "08006" });
  });
});
