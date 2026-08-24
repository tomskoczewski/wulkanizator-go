import type { AppointmentStatus } from "@/types";

/**
 * The single source of truth for "which status can follow which" — imported by the API to reject
 * an illegal move, and by both UI surfaces to decide which buttons are live. Pure, no Supabase
 * import, mirroring `day-plan.ts` and `slot-suggestions.ts` beside it.
 */

/** The ordered spine the detail page's 3-step grid renders and the day plan advances along. */
export const FORWARD_STEPS: readonly AppointmentStatus[] = ["waiting", "in_progress", "done"];

/** The guided one-tap step. `null` for a terminal or out-of-scope status — nothing forward from it. */
export function nextStatus(current: AppointmentStatus): AppointmentStatus | null {
  switch (current) {
    case "waiting":
      return "in_progress";
    case "in_progress":
      return "done";
    case "done":
    case "no_show":
    case "cancelled":
      return null;
  }
}

/**
 * The API guard: true when `from !== to`, neither side is `cancelled`, and both are valid enum
 * members. Every non-`cancelled` pair is legal except a no-op — `cancelled` is immutable in both
 * directions, so this slice can neither create nor resurrect one. `cancelled` is handled explicitly
 * rather than by omission, so a sixth enum value later surfaces as a type error here.
 */
export function isTransitionAllowed(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return false;
  if (from === "cancelled" || to === "cancelled") return false;
  return true;
}
