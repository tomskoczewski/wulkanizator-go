import { z } from "zod";
import { workshopTodayDateString } from "@/lib/workshop-clock";

// Value-range constrained, not just digit shape — the gap flagged as F4 in S-02's implementation
// review, and matching the STARTS_AT_PATTERN precedent in schemas/appointment.ts.
const DATE_STRING_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const dayPlanDateSchema = z.string().trim().regex(DATE_STRING_PATTERN, "Nieprawidłowy format daty");

/** A malformed or absent `?data=` value resolves to the workshop's today rather than erroring. */
export function resolveDayParam(raw: string | null): string {
  const result = dayPlanDateSchema.safeParse(raw);
  return result.success ? result.data : workshopTodayDateString();
}
