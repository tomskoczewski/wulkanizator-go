import type { TypedSupabaseClient } from "@/lib/supabase";
import type { AppointmentBookingRequestInput } from "@/lib/schemas/appointment";
import type { Appointment } from "@/types";
import { getWorkshopNow, naiveDateToTimestampString, timestampStringToNaiveDate } from "@/lib/workshop-clock";
import {
  DEFAULT_STEP_MIN,
  suggestSlots,
  type Interval,
  type SlotBay,
  type SuggestedSlot,
} from "@/lib/services/slot-suggestions";

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
    return { slots: [], emptyReason: "no_active_bays" };
  }

  if (inputs.dayWindows.length === 0) {
    return { slots: [], emptyReason: "closed_all_week" };
  }

  const slots = suggestSlots({
    dayWindows: inputs.dayWindows,
    bays: inputs.bays,
    busyByBay: inputs.busyByBay,
    durationMin: inputs.durationMin,
    earliest: earliest ?? inputs.workshopNow,
  });

  return { slots, emptyReason: slots.length === 0 ? "no_slots" : null };
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

  const { data: serviceRow, error: serviceError } = await supabase
    .from("services")
    .select("duration_min")
    .eq("id", input.service_id)
    .single();
  if (serviceError) throw serviceError;

  const startsAt = timestampStringToNaiveDate(input.starts_at);
  const endsAt = new Date(startsAt.getTime() + serviceRow.duration_min * 60_000);

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
