import { useState, type ComponentType } from "react";
import { CheckCircle2, Clock, Phone, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestJson } from "@/components/hooks/useJsonMutation";
import { FORWARD_STEPS, isTransitionAllowed } from "@/lib/services/appointment-transitions";
import type { AppointmentStatus, DayPlanEntry } from "@/types";

interface Props {
  id: string;
  status: AppointmentStatus;
  customerPhone: string;
}

const STEP_META: Record<
  "waiting" | "in_progress" | "done",
  { icon: ComponentType<{ size?: number; className?: string }>; label: string; note: string }
> = {
  waiting: { icon: Clock, label: "Oczekuje", note: "Klient zapisany" },
  in_progress: { icon: Wrench, label: "W trakcie", note: "Auto na stanowisku" },
  done: { icon: CheckCircle2, label: "Gotowe", note: "Można rozliczyć" },
};

/**
 * The interactive half of the detail page — the "Szybka zmiana statusu" step grid plus the
 * sidebar actions. Mounted once (`client:load`) as a direct child of the page's `xl:grid-cols-[1fr_300px]`
 * grid: `astro-island` renders with `display: contents`, so this component's two top-level blocks
 * (step grid, sidebar) become direct grid items in their own right — explicit `xl:col-start`/`xl:row-start`
 * below place them without depending on DOM order.
 */
export function AppointmentStatusPanel({ id, status: initialStatus, customerPhone }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [pendingTarget, setPendingTarget] = useState<AppointmentStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isPending = pendingTarget !== null;

  async function changeStatus(target: AppointmentStatus) {
    if (isPending || !isTransitionAllowed(status, target)) return;

    const from = status;
    setPendingTarget(target);
    setMessage(null);
    setStatus(target);

    const result = await requestJson<DayPlanEntry | { id: string; status: AppointmentStatus }>(
      `/api/appointment-status/${id}`,
      "PATCH",
      { status: target, from },
    );

    if (!result.ok) {
      // A 409 carries the row's true server-side status — resync to it rather than rolling back
      // to the stale value we started from. Any other failure reverts the optimistic change.
      const body = result.failure.body as { current?: AppointmentStatus } | null;
      if (result.failure.status === 409 && body?.current) {
        setStatus(body.current);
      } else {
        setStatus(from);
      }
      setMessage(result.failure.message ?? "Coś poszło nie tak. Spróbuj ponownie.");
    }

    setPendingTarget(null);
  }

  return (
    <>
      <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 xl:col-start-1 xl:row-start-2">
        <div className="mb-2 text-xs font-black text-slate-700">Szybka zmiana statusu</div>
        <div className="grid gap-2 md:grid-cols-3">
          {FORWARD_STEPS.map((step) => {
            // FORWARD_STEPS is typed `readonly AppointmentStatus[]` (see appointment-transitions.ts)
            // but its three literal members are exactly STEP_META's keys.
            const meta = STEP_META[step as keyof typeof STEP_META];
            const Icon = meta.icon;
            const isActive = step === status;
            return (
              <button
                key={step}
                type="button"
                disabled={isPending || !isTransitionAllowed(status, step)}
                onClick={() => changeStatus(step)}
                className={cn(
                  "rounded-xl p-3 text-left disabled:cursor-not-allowed",
                  isActive ? "bg-amber-100 ring-2 ring-amber-200" : "bg-white ring-1 ring-slate-100",
                  !isActive && "disabled:opacity-50",
                )}
              >
                <Icon size={18} className={isActive ? "text-amber-700" : "text-slate-500"} />
                <div className="mt-2 text-xs font-black text-slate-900">{meta.label}</div>
                <div className="text-xs font-bold text-slate-500">{meta.note}</div>
              </button>
            );
          })}
        </div>
        {message && <p className="mt-3 text-xs font-bold text-rose-600">{message}</p>}
      </div>

      <div className="space-y-3 xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <a
          href={`tel:${customerPhone}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white"
        >
          <Phone size={16} />
          Zadzwoń
        </a>
        <button
          type="button"
          disabled={isPending || !isTransitionAllowed(status, "no_show")}
          onClick={() => changeStatus("no_show")}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-3 text-sm font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <XCircle size={16} />
          Nie przyjechał
        </button>
      </div>
    </>
  );
}
