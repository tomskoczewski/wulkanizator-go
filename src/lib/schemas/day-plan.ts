import { z } from "zod";
import { workshopTodayDateString } from "@/lib/workshop-clock";

// Value-range constrained, not just digit shape — the gap flagged as F4 in S-02's implementation
// review, and matching the STARTS_AT_PATTERN precedent in schemas/appointment.ts.
const DATE_STRING_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// The regex alone accepts calendar-invalid combinations the pattern's day/month ranges don't rule
// out (e.g. 2026-02-30). `Date.UTC` silently normalizes overflow (Feb 30 -> Mar 2), so round-trip
// through it and compare the parsed components back — the same technique `shiftDateString` relies
// on for arithmetic — to catch what the regex can't.
function isCalendarValidDate(value: string): boolean {
  const match = DATE_STRING_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

export const dayPlanDateSchema = z
  .string()
  .trim()
  .regex(DATE_STRING_PATTERN, "Nieprawidłowy format daty")
  .refine(isCalendarValidDate, "Nieprawidłowa data");

/** A malformed or absent `?data=` value resolves to the workshop's today rather than erroring. */
export function resolveDayParam(raw: string | null): string {
  const result = dayPlanDateSchema.safeParse(raw);
  return result.success ? result.data : workshopTodayDateString();
}
