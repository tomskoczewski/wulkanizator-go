import type { TypedSupabaseClient } from "@/lib/supabase";
import type { AppointmentBookingRequestInput, AppointmentStatusChangeInput } from "@/lib/schemas/appointment";
import type { Appointment, AppointmentStatus, WorkingHours } from "@/types";
import {
  getWorkshopNow,
  naiveDateToTimestampString,
  shiftDateString,
  timestampStringToNaiveDate,
} from "@/lib/workshop-clock";
import {
  DEFAULT_STEP_MIN,
  suggestSlots,
  type Interval,
  type SlotBay,
  type SuggestedSlot,
} from "@/lib/services/slot-suggestions";
import { sortDayPlan, type DayPlanEntry } from "@/lib/services/day-plan";
import { isTransitionAllowed } from "@/lib/services/appointment-transitions";

/**
 * RLS scopes every query below to the caller's own workshop, following `workshop-setup.ts`: no
 * function here accepts a `workshop_id` parameter. The single write path, `bookAppointment()`,
 * goes through the `book_appointment` RPC rather than two separate inserts — see the migration's
 * comment for why a client-side transaction can't substitute for the database one.
 */

const HORIZON_DAYS = 14;

export type EmptyReason = "no_active_bays" | "closed_all_week" | "no_slots" | null;

export interface SuggestionResult {
  slots: SuggestedSlot[];
  emptyReason: EmptyReason;
  durationMin: number;
}

export interface WireSlot {
  bayId: string;
  bayName: string;
  start: string;
  end: string;
}

/**
 * Serializes a slot's `Date` fields to the same naive-timestamp wire format `starts_at` is
 * validated against (`STARTS_AT_PATTERN` in `schemas/appointment.ts`), so a client can echo a
 * chosen slot's `start` straight back as a booking request's `starts_at` with no reformatting.
 */
export function toWireSlot(slot: SuggestedSlot): WireSlot {
  return {
    bayId: slot.bayId,
    bayName: slot.bayName,
    start: naiveDateToTimestampString(slot.start),
    end: naiveDateToTimestampString(slot.end),
  };
}

export type BookOutcome =
  | { status: "created"; appointment: Appointment }
  | { status: "conflict"; slots: SuggestedSlot[]; emptyReason: EmptyReason };

interface SuggestionInputs {
  durationMin: number;
  bays: SlotBay[];
  dayWindows: Interval[];
  busyByBay: Map<string, Interval[]>;
  workshopNow: Date;
}

function combineDateAndTime(date: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function fetchSuggestionInputs(supabase: TypedSupabaseClient, serviceId: string): Promise<SuggestionInputs> {
  const workshopNow = getWorkshopNow();
  const todayDateOnly = new Date(
    Date.UTC(workshopNow.getUTCFullYear(), workshopNow.getUTCMonth(), workshopNow.getUTCDate()),
  );
  const horizonEnd = addDays(todayDateOnly, HORIZON_DAYS);

  const [serviceResult, baysResult, hoursResult, appointmentsResult] = await Promise.all([
    supabase.from("services").select("duration_min").eq("id", serviceId).single(),
    supabase.from("bays").select("id, name").eq("is_active", true).order("created_at"),
    supabase.from("working_hours").select("weekday, opens_at, closes_at, is_closed"),
    supabase
      .from("appointments")
      .select("bay_id, starts_at, ends_at")
      .not("status", "in", "(cancelled,no_show)")
      .gte("starts_at", naiveDateToTimestampString(todayDateOnly))
      .lt("starts_at", naiveDateToTimestampString(horizonEnd)),
  ]);

  if (serviceResult.error) throw serviceResult.error;
  if (baysResult.error) throw baysResult.error;
  if (hoursResult.error) throw hoursResult.error;
  if (appointmentsResult.error) throw appointmentsResult.error;

  const bays: SlotBay[] = baysResult.data.map((bay) => ({ id: bay.id, name: bay.name }));

  const workingHoursByWeekday = new Map(hoursResult.data.map((row) => [row.weekday, row]));
  const dayWindows: Interval[] = [];
  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const date = addDays(todayDateOnly, offset);
    const hours = workingHoursByWeekday.get(date.getUTCDay());
    if (!hours || hours.is_closed || !hours.opens_at || !hours.closes_at) continue;
    dayWindows.push({
      start: combineDateAndTime(date, hours.opens_at),
      end: combineDateAndTime(date, hours.closes_at),
    });
  }

  const busyByBay = new Map<string, Interval[]>();
  for (const appointment of appointmentsResult.data) {
    const interval: Interval = {
      start: timestampStringToNaiveDate(appointment.starts_at),
      end: timestampStringToNaiveDate(appointment.ends_at),
    };
    const existing = busyByBay.get(appointment.bay_id);
    if (existing) {
      existing.push(interval);
    } else {
      busyByBay.set(appointment.bay_id, [interval]);
    }
  }

  return { durationMin: serviceResult.data.duration_min, bays, dayWindows, busyByBay, workshopNow };
}

/**
 * Suggests the nearest free slots for a service. An empty result is not an error, but the three
 * ways of reaching it need different messages — see `EmptyReason`.
 */
export async function suggestSlotsForService(
  supabase: TypedSupabaseClient,
  serviceId: string,
  earliest?: Date,
): Promise<SuggestionResult> {
  const inputs = await fetchSuggestionInputs(supabase, serviceId);

  if (inputs.bays.length === 0) {
    return { slots: [], emptyReason: "no_active_bays", durationMin: inputs.durationMin };
  }

  if (inputs.dayWindows.length === 0) {
    return { slots: [], emptyReason: "closed_all_week", durationMin: inputs.durationMin };
  }

  const slots = suggestSlots({
    dayWindows: inputs.dayWindows,
    bays: inputs.bays,
    busyByBay: inputs.busyByBay,
    durationMin: inputs.durationMin,
    earliest: earliest ?? inputs.workshopNow,
  });

  return { slots, emptyReason: slots.length === 0 ? "no_slots" : null, durationMin: inputs.durationMin };
}

/**
 * Books an appointment for a walk-in customer. Re-validates the requested `(bay_id, starts_at)`
 * pair against a freshly-computed suggestion list before inserting anything — the exclusion
 * constraint only catches overlaps, not a bay deactivated or a working day shortened since the
 * client loaded its chips. `earliest` is relaxed by one step so a slot chosen seconds ago at the
 * window edge isn't rejected for having aged past "now".
 *
 * Both rows are inserted through the `book_appointment` RPC, a single implicit transaction: a lost
 * race on the exclusion constraint rolls back the customer insert too, so retrying never leaves an
 * orphan `customers` row.
 */
export async function bookAppointment(
  supabase: TypedSupabaseClient,
  input: AppointmentBookingRequestInput,
): Promise<BookOutcome> {
  const relaxedEarliest = new Date(getWorkshopNow().getTime() - DEFAULT_STEP_MIN * 60_000);
  const requestedStart = timestampStringToNaiveDate(input.starts_at).getTime();

  const preflight = await suggestSlotsForService(supabase, input.service_id, relaxedEarliest);
  const stillOffered = preflight.slots.some(
    (slot) => slot.bayId === input.bay_id && slot.start.getTime() === requestedStart,
  );

  if (!stillOffered) {
    return { status: "conflict", slots: preflight.slots, emptyReason: preflight.emptyReason };
  }

  const startsAt = timestampStringToNaiveDate(input.starts_at);
  const endsAt = new Date(startsAt.getTime() + preflight.durationMin * 60_000);

  const { data, error } = await supabase.rpc("book_appointment", {
    p_first_name: input.first_name,
    p_phone: input.phone,
    p_service_id: input.service_id,
    p_bay_id: input.bay_id,
    p_starts_at: naiveDateToTimestampString(startsAt),
    p_ends_at: naiveDateToTimestampString(endsAt),
  });

  if (error) {
    if (error.code === "23P01") {
      const fresh = await suggestSlotsForService(supabase, input.service_id);
      return { status: "conflict", slots: fresh.slots, emptyReason: fresh.emptyReason };
    }
    throw error;
  }

  return { status: "created", appointment: data };
}

const DAY_PLAN_SELECT =
  "id, status, starts_at, ends_at, customers(first_name, phone), services(name, duration_min), bays(name)";

interface DayPlanRow {
  id: string;
  status: DayPlanEntry["status"];
  starts_at: string;
  ends_at: string;
  customers: { first_name: string; phone: string } | null;
  services: { name: string; duration_min: number } | null;
  bays: { name: string } | null;
}

function toDayPlanEntry(row: DayPlanRow): DayPlanEntry | null {
  if (!row.customers || !row.services || !row.bays) {
    console.warn(`day-plan: dropping appointment ${row.id} with a missing join`);
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    customerFirstName: row.customers.first_name,
    customerPhone: row.customers.phone,
    serviceName: row.services.name,
    durationMin: row.services.duration_min,
    bayName: row.bays.name,
  };
}

function weekdayForDateString(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Fetches one day's appointments, joined to `customers`, `services` and `bays`, plus the working
 * hours row for that weekday — which is what lets the screen tell a closed day from a merely empty
 * one. RLS scopes both queries to the caller's workshop, so neither takes a `workshop_id` parameter.
 * `cancelled` appointments are excluded; a row with an impossible-by-schema null join is dropped
 * (logged, not thrown) rather than crashing the north-star screen on a non-null assertion.
 */
export async function getDayPlan(
  supabase: TypedSupabaseClient,
  date: string,
): Promise<{ entries: DayPlanEntry[]; workingHours: WorkingHours | null }> {
  const nextDate = shiftDateString(date, 1);
  const weekday = weekdayForDateString(date);

  const [appointmentsResult, hoursResult] = await Promise.all([
    supabase
      .from("appointments")
      .select(DAY_PLAN_SELECT)
      .gte("starts_at", `${date} 00:00:00`)
      .lt("starts_at", `${nextDate} 00:00:00`)
      .neq("status", "cancelled"),
    supabase.from("working_hours").select("*").eq("weekday", weekday).maybeSingle(),
  ]);

  if (appointmentsResult.error) throw appointmentsResult.error;
  if (hoursResult.error) throw hoursResult.error;

  const entries = (appointmentsResult.data as DayPlanRow[])
    .map(toDayPlanEntry)
    .filter((entry): entry is DayPlanEntry => entry !== null);

  return { entries: sortDayPlan(entries), workingHours: hoursResult.data };
}

/** Same join as `getDayPlan`, for a single id. Returns `null` for a bad id or another workshop's id
 * — RLS makes the two indistinguishable, so this never leaks existence. */
export async function getAppointmentDetail(supabase: TypedSupabaseClient, id: string): Promise<DayPlanEntry | null> {
  const { data, error } = await supabase.from("appointments").select(DAY_PLAN_SELECT).eq("id", id).maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toDayPlanEntry(data);
}

export type StatusChangeOutcome =
  // `entry` is null only when the row's joins are incomplete — the write still committed, so
  // `current` is what the client settles its optimistic state on.
  | { status: "updated"; current: AppointmentStatus; entry: DayPlanEntry | null }
  | { status: "stale"; current: AppointmentStatus }
  | { status: "slot_taken" }
  | { status: "not_found" }
  | { status: "illegal" };

/**
 * The single write path for a status change. Compare-and-set: the update is scoped to the row's
 * believed current status, so a concurrent change by another user is detected (`stale`) rather
 * than silently overwritten. `isTransitionAllowed()` is the sole authority on legal moves — this
 * function does not duplicate that table.
 */
export async function changeAppointmentStatus(
  supabase: TypedSupabaseClient,
  id: string,
  input: AppointmentStatusChangeInput,
): Promise<StatusChangeOutcome> {
  // Returned, not thrown: the route's exhaustive switch then has to handle it, so this stays a 400
  // by construction rather than by the route recognising an error message.
  if (!isTransitionAllowed(input.from, input.status)) {
    return { status: "illegal" };
  }

  const { data, error } = await supabase
    .from("appointments")
    .update({ status: input.status })
    .eq("id", id)
    .eq("status", input.from)
    .select(DAY_PLAN_SELECT)
    .maybeSingle();

  if (error) {
    if (error.code === "23P01") {
      return { status: "slot_taken" };
    }
    throw error;
  }

  if (!data) {
    // Zero rows affected: either the row moved underneath the caller (stale) or it isn't visible
    // to this caller at all (not_found — RLS makes "wrong workshop" and "doesn't exist"
    // indistinguishable, matching getAppointmentDetail()'s posture). Never synthesize a `stale`
    // carrying the client's own `from` — that would tell the client its stale belief is the truth
    // while also signalling a conflict.
    //
    // This asks about existence, not presentation, so it reads `status` directly rather than
    // reusing getAppointmentDetail(): that funnels through toDayPlanEntry(), which returns null on
    // an incomplete join — which would report a row that exists and merely moved as `not_found`.
    const { data: existing, error: readError } = await supabase
      .from("appointments")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    if (!existing) return { status: "not_found" };

    // Someone else already moved the row to the status this caller was asking for. The requested
    // end state holds, so this is a success, not a conflict — two workers tapping the same button
    // is the common case on a shared day plan, and reporting it as an error would show a failure
    // for an operation that achieved exactly what was asked.
    if (existing.status === input.status) {
      return { status: "updated", current: existing.status, entry: null };
    }

    return { status: "stale", current: existing.status };
  }

  // The UPDATE has already committed by this point — a thrown error past here would roll the
  // client's optimistic change back while the database holds the new status. On an incomplete
  // join, still report success with the confirmed status; toDayPlanEntry()'s own console.warn
  // carries the diagnostic.
  return { status: "updated", current: input.status, entry: toDayPlanEntry(data) };
}
