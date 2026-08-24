import { useState } from "react";
import { Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/appointments/StatusPill";
import { useRowMutation } from "@/components/hooks/useJsonMutation";
import { DAY_PLAN_FILTER_STATUSES, APPOINTMENT_STATUS_PRESENTATION } from "@/lib/appointment-status";
import { nextStatus } from "@/lib/services/appointment-transitions";
import { countByStatus, filterByStatus, type DayPlanEntry } from "@/lib/services/day-plan";
import type { AppointmentStatus, WorkingHours } from "@/types";

interface Props {
  entries: DayPlanEntry[];
  workingHours: WorkingHours | null;
  date: string;
  prevDate: string;
  nextDate: string;
  today: string;
}

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Poniedziałek",
  2: "Wtorek",
  3: "Środa",
  4: "Czwartek",
  5: "Piątek",
  6: "Sobota",
  0: "Niedziela",
};

const MONTH_LABELS: Record<number, string> = {
  0: "stycznia",
  1: "lutego",
  2: "marca",
  3: "kwietnia",
  4: "maja",
  5: "czerwca",
  6: "lipca",
  7: "sierpnia",
  8: "września",
  9: "października",
  10: "listopada",
  11: "grudnia",
};

function dayHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAY_LABELS[asUtc.getUTCDay()]}, ${asUtc.getUTCDate()} ${MONTH_LABELS[asUtc.getUTCMonth()]}`;
}

function timeLabel(wire: string): string {
  return /\d{2}:\d{2}/.exec(wire)?.[0] ?? wire;
}

export default function DayPlanBoard({
  entries: initialEntries,
  workingHours,
  date,
  prevDate,
  nextDate,
  today,
}: Props) {
  const [entries, setEntries] = useState<DayPlanEntry[]>(initialEntries);
  const [filter, setFilter] = useState<AppointmentStatus | null>(null);
  // Ids advanced under the current filter, kept visible even after the tap moves them out of
  // `filterByStatus`'s result — otherwise the card would vanish mid-tap. Cleared on filter change.
  const [recentlyChanged, setRecentlyChanged] = useState<ReadonlySet<string>>(() => new Set());
  const { run, isPending, rowErrors } = useRowMutation();

  const counts = countByStatus(entries);
  const filteredIds = new Set(filterByStatus(entries, filter).map((entry) => entry.id));
  const visible = entries.filter((entry) => filteredIds.has(entry.id) || recentlyChanged.has(entry.id));
  const isToday = date === today;
  const isClosed = !workingHours || workingHours.is_closed;

  function changeFilter(next: AppointmentStatus | null) {
    setFilter(next);
    setRecentlyChanged(new Set());
  }

  async function advance(entry: DayPlanEntry) {
    const target = nextStatus(entry.status);
    if (!target) return;
    const from = entry.status;

    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: target } : e)));
    setRecentlyChanged((prev) => new Set(prev).add(entry.id));

    await run(
      entry.id,
      { url: `/api/appointment-status/${entry.id}`, method: "PATCH", body: { status: target, from } },
      {
        rollback: () => {
          setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: from } : e)));
        },
        fallbackMessage: "Coś poszło nie tak. Spróbuj ponownie.",
        onFailure: (failure) => {
          // A 409 carries the row's true server-side status — resync to it rather than rolling
          // back to the stale value we started from.
          if (failure.status === 409) {
            const body = failure.body as { current?: AppointmentStatus } | null;
            if (body?.current) {
              const current = body.current;
              setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: current } : e)));
              return true;
            }
          }
          return false;
        },
      },
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Dzisiaj</h2>
          <p className="text-xs font-medium text-slate-500">
            {dayHeading(date)} · {counts.total} wizyt
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/dashboard?data=${prevDate}`}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
          >
            ‹
          </a>
          {isToday ? (
            <span className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-400">
              Dzisiaj
            </span>
          ) : (
            <a
              href={`/dashboard?data=${today}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-50"
            >
              Dzisiaj
            </a>
          )}
          <a
            href={`/dashboard?data=${nextDate}`}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
          >
            ›
          </a>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Wizyty" value={counts.total} tone="slate" />
        <Stat label="Oczekuje" value={counts.waiting} tone="amber" />
        <Stat label="Gotowe" value={counts.done} tone="emerald" />
        <Stat label="Nie przyjechał" value={counts.noShow} tone="rose" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            changeFilter(null);
          }}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-black",
            filter === null ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-100",
          )}
        >
          Wszystkie
        </button>
        {DAY_PLAN_FILTER_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              changeFilter(status);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-black",
              filter === status ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-100",
            )}
          >
            {APPOINTMENT_STATUS_PRESENTATION[status].label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-100">
          <p className="text-sm font-bold text-slate-700">
            {isClosed ? "Warsztat jest zamknięty tego dnia." : "Brak wizyt tego dnia."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) => {
            const target = nextStatus(entry.status);
            const pending = isPending(entry.id);
            const rowError = rowErrors[entry.id];

            return (
              <div
                key={entry.id}
                className="relative grid grid-cols-[60px_1fr] gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100 hover:ring-orange-200"
              >
                {/* Stretched-link overlay: navigation stays a real `<a>` covering the whole card,
                    while the advance button sits above it (z-10) as a sibling — a `<button>`
                    nested inside an `<a>` is invalid HTML and its click would be swallowed. */}
                <a
                  href={`/wizyty/${entry.id}`}
                  className="absolute inset-0 z-0 rounded-2xl"
                  aria-label={`Szczegóły wizyty — ${entry.customerFirstName}`}
                />
                <div className="relative z-10 text-center">
                  <div className="text-sm font-black text-slate-900">{timeLabel(entry.startsAt)}</div>
                  <div className="text-xs font-bold text-slate-400">{timeLabel(entry.endsAt)}</div>
                </div>
                <div className="relative z-10">
                  <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-900">{entry.customerFirstName}</div>
                      <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Car size={12} />
                        {entry.bayName}
                      </div>
                    </div>
                    <StatusPill status={entry.status} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-800">{entry.serviceName}</div>
                      <div className="text-xs font-medium text-slate-500">{entry.durationMin} min</div>
                    </div>
                    {target && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          void advance(entry);
                        }}
                        className="relative z-10 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {pending ? "…" : APPOINTMENT_STATUS_PRESENTATION[target].label}
                      </button>
                    )}
                  </div>
                  {rowError && <p className="relative z-10 mt-2 text-xs font-bold text-rose-600">{rowError}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "slate" | "amber" | "emerald" | "rose" }) {
  const tones: Record<typeof tone, string> = {
    slate: "from-slate-500 to-slate-700",
    amber: "from-amber-400 to-orange-500",
    emerald: "from-emerald-500 to-teal-500",
    rose: "from-rose-400 to-pink-500",
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-100">
      <div className={cn("bg-gradient-to-r bg-clip-text text-2xl font-black text-transparent", tones[tone])}>
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold text-slate-500">{label}</div>
    </div>
  );
}
