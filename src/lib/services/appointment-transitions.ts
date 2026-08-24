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
 * Whether a status may take part in a transition at all, in either direction. A `Record` keyed by
 * `AppointmentStatus` rather than an if-chain with a catch-all, so a sixth enum value fails the
 * build here instead of silently becoming freely transitionable — the same reason
 * `APPOINTMENT_STATUS_PRESENTATION` is shaped this way.
 */
const IS_MUTABLE: Record<AppointmentStatus, boolean> = {
  waiting: true,
  in_progress: true,
  done: true,
  no_show: true,
  cancelled: false,
};

/**
 * The API guard: true when `from !== to` and neither side is `cancelled`. Every non-`cancelled`
 * pair is legal except a no-op — `cancelled` is immutable in both directions, so this slice can
 * neither create nor resurrect one.
 */
export function isTransitionAllowed(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return false;
  return IS_MUTABLE[from] && IS_MUTABLE[to];
}
