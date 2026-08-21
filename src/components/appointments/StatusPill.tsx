import { cn } from "@/lib/utils";
import { APPOINTMENT_STATUS_PRESENTATION } from "@/lib/appointment-status";
import type { AppointmentStatus } from "@/types";

export function StatusPill({ status }: { status: AppointmentStatus }) {
  const { label, pillClasses } = APPOINTMENT_STATUS_PRESENTATION[status];

  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", pillClasses)}
    >
      {label}
    </span>
  );
}
