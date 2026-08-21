/**
 * Owns the single timezone conversion this system needs. The Worker runtime runs in UTC, but every
 * appointment time is workshop-local wall-clock (`Europe/Warsaw`), stored as a naive Postgres
 * `timestamp` with no zone attached. `getWorkshopNow()` answers "what is the wall-clock date and
 * time in the workshop right now" by returning a naive `Date` whose *UTC* fields hold the
 * workshop-local values — so `getUTCDay()` on the result yields the Postgres `dow` weekday
 * directly, and `getUTCHours()` / `getUTCMinutes()` yield the local clock time.
 *
 * The inverse (local wall-clock -> real instant) is deliberately not implemented: nothing in this
 * system ever converts a naive appointment time back into an instant, since the times are never
 * compared against anything outside the workshop's own clock. Adding that direction would
 * reintroduce the exact two-pass-offset bug class this design avoids.
 */

export const WORKSHOP_TIME_ZONE = "Europe/Warsaw";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKSHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * The current workshop-local wall-clock, as a naive `Date` (UTC fields hold local values). Use
 * `getUTCDay()` for the Postgres `dow` weekday — never `getDay()`, which re-applies the runtime's
 * own zone and reads back the wrong weekday whenever UTC and Warsaw disagree on the date.
 */
export function getWorkshopNow(now: Date = new Date()): Date {
  const parts = Object.fromEntries(partsFormatter.formatToParts(now).map((part) => [part.type, part.value]));

  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}

/** Formats a naive `Date` (UTC fields hold local values) as a Postgres `timestamp` literal. */
export function naiveDateToTimestampString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** The workshop-local date, as `YYYY-MM-DD`, for the given instant (or now). */
export function workshopTodayDateString(now?: Date): string {
  return naiveDateToTimestampString(getWorkshopNow(now)).slice(0, 10);
}

const DATE_STRING_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Shifts a naive `YYYY-MM-DD` string by `days`, via `Date.UTC` arithmetic only. */
export function shiftDateString(date: string, days: number): string {
  const match = DATE_STRING_PATTERN.exec(date);

  if (!match) {
    throw new Error(`invalid date string: ${date}`);
  }

  const [, year, month, day] = match;
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** Parses a Postgres `timestamp` literal into a naive `Date` (UTC fields hold local values). */
export function timestampStringToNaiveDate(value: string): Date {
  const match = TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    throw new Error(`invalid naive timestamp string: ${value}`);
  }

  const [, year, month, day, hour, minute, second] = match;

  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), second ? Number(second) : 0),
  );
}
