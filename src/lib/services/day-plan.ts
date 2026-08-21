import type { AppointmentStatus } from "@/types";

/**
 * The sort order, the four tile counts, and the status filter for a day's appointments — all pure,
 * so they are testable without Supabase, mirroring the `slot-suggestions.ts` split beneath
 * `appointments.ts`. This file holds no I/O; the query that feeds it lives in `appointments.ts`.
 *
 * `cancelled` rows never reach these functions — the query in `appointments.ts` excludes them, so
 * the board only ever sees bookings that still stand.
 *
 * Ordering and filtering compare the naive wire strings (`YYYY-MM-DDTHH:MM:SS` or with a space
 * separator) directly rather than via `Date`: the format is zero-padded and left-aligned, so byte
 * order matches chronological order. Never slice by a fixed index to extract a component — a
 * `timestamp(6)` column can carry a variable-length fractional-second tail.
 */

export interface DayPlanEntry {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  customerFirstName: string;
  customerPhone: string;
  serviceName: string;
  durationMin: number;
  bayName: string;
}

export interface DayPlanCounts {
  total: number;
  waiting: number;
  done: number;
  noShow: number;
}

/** Ascending `startsAt`, bay name as tie-break — matching `slot-suggestions.ts`'s ordering rule. */
export function sortDayPlan(entries: DayPlanEntry[]): DayPlanEntry[] {
  return [...entries].sort(
    (a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0) || a.bayName.localeCompare(b.bayName),
  );
}

/** The four day-plan tile counts. `in_progress` rows count toward `total` but have no tile of their own. */
export function countByStatus(entries: DayPlanEntry[]): DayPlanCounts {
  const counts: DayPlanCounts = { total: entries.length, waiting: 0, done: 0, noShow: 0 };

  for (const entry of entries) {
    if (entry.status === "waiting") counts.waiting += 1;
    else if (entry.status === "done") counts.done += 1;
    else if (entry.status === "no_show") counts.noShow += 1;
  }

  return counts;
}

/** `null` means *Wszystkie* — every entry unchanged. */
export function filterByStatus(entries: DayPlanEntry[], status: AppointmentStatus | null): DayPlanEntry[] {
  if (status === null) return entries;
  return entries.filter((entry) => entry.status === status);
}
