import type { AppointmentStatus } from "@/types";

/**
 * The single mapping from an `appointment_status` enum literal to its Polish label and Tailwind
 * pill classes, locked in `context/foundation/design-system.md:82-88`. `Record<AppointmentStatus, …>`
 * rather than a lookup with a default: a future enum value fails the build here instead of silently
 * falling through.
 */
export interface AppointmentStatusPresentation {
  label: string;
  pillClasses: string;
}

export const APPOINTMENT_STATUS_PRESENTATION: Record<AppointmentStatus, AppointmentStatusPresentation> = {
  waiting: { label: "Oczekuje", pillClasses: "bg-amber-100 text-amber-800 border-amber-200" },
  in_progress: { label: "W trakcie", pillClasses: "bg-blue-100 text-blue-800 border-blue-200" },
  done: { label: "Gotowe", pillClasses: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  no_show: { label: "Nie przyjechał", pillClasses: "bg-rose-100 text-rose-800 border-rose-200" },
  cancelled: { label: "Anulowane", pillClasses: "bg-slate-100 text-slate-700 border-slate-200" },
};

/**
 * Display order for the day plan's filter pills. `cancelled` is deliberately absent — the brochure
 * has no such pill and the board never surfaces a cancelled row (see `day-plan.ts`).
 */
export const DAY_PLAN_FILTER_STATUSES: readonly AppointmentStatus[] = ["waiting", "in_progress", "done", "no_show"];
