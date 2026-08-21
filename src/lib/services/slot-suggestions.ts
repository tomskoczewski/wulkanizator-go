/**
 * Given a sequence of day windows, the active bays, their busy intervals, and a service duration,
 * produces the nearest free slots ranked by start time — rolling into the next supplied day when
 * an earlier day cannot fill the limit. Pure and synchronous: no Supabase, no I/O, so the edge
 * matrix is testable without a database. A thin service (`src/lib/services/appointments.ts`)
 * fetches the inputs and builds the day windows.
 *
 * All `Date` values here are naive: their UTC fields hold workshop-local wall-clock values (see
 * `src/lib/workshop-clock.ts`). Intervals are half-open `[start, end)`, matching the
 * `appointments_no_overlap_per_bay` exclusion constraint, so a slot ending exactly when a busy
 * block starts is legal.
 */

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotBay {
  id: string;
  name: string;
}

export interface SuggestedSlot {
  bayId: string;
  bayName: string;
  start: Date;
  end: Date;
}

export interface SuggestSlotsInput {
  /** One window per candidate day, in chronological order. A closed day contributes no window. */
  dayWindows: Interval[];
  bays: SlotBay[];
  /** Existing appointments per bay, excluding `cancelled`/`no_show`. */
  busyByBay: Map<string, Interval[]>;
  durationMin: number;
  /** No slot may start before this instant — typically workshop-local "now". */
  earliest: Date;
  /** Grid granularity in minutes. */
  stepMin?: number;
  limit?: number;
}

const DEFAULT_STEP_MIN = 15;
const DEFAULT_LIMIT = 6;

export function suggestSlots(input: SuggestSlotsInput): SuggestedSlot[] {
  const step = (input.stepMin ?? DEFAULT_STEP_MIN) * 60_000;
  const durationMs = input.durationMin * 60_000;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const results: SuggestedSlot[] = [];

  for (const window of input.dayWindows) {
    if (results.length >= limit) break;

    const dayResults: SuggestedSlot[] = [];

    for (const bay of input.bays) {
      const busy = [...(input.busyByBay.get(bay.id) ?? [])].sort((a, b) => +a.start - +b.start);

      let cursor = Math.ceil(Math.max(+window.start, +input.earliest) / step) * step;

      while (cursor + durationMs <= +window.end) {
        const collision = busy.find((block) => cursor < +block.end && cursor + durationMs > +block.start);

        if (collision) {
          cursor = Math.ceil(+collision.end / step) * step;
          continue;
        }

        dayResults.push({
          bayId: bay.id,
          bayName: bay.name,
          start: new Date(cursor),
          end: new Date(cursor + durationMs),
        });
        cursor += step;
      }
    }

    dayResults.sort((a, b) => +a.start - +b.start || a.bayName.localeCompare(b.bayName));
    results.push(...dayResults);
  }

  return results.slice(0, limit);
}
