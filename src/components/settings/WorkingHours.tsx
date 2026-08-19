import { useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkingHours as WorkingHoursRow } from "@/types";

interface Props {
  initialHours: WorkingHoursRow[];
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

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function toTimeInputValue(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

export function WorkingHours({ initialHours }: Props) {
  const [hours, setHours] = useState(initialHours);
  const [pendingWeekday, setPendingWeekday] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  async function save(
    weekday: number,
    draft: { opens_at: string | null; closes_at: string | null; is_closed: boolean },
  ) {
    const previous = hours.find((h) => h.weekday === weekday);
    setHours((prev) => prev.map((h) => (h.weekday === weekday ? { ...h, ...draft } : h)));
    setPendingWeekday(weekday);
    setRowErrors((prev) => ({ ...prev, [weekday]: "" }));

    const res = await fetch(`/api/working-hours/${weekday}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });

    setPendingWeekday(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errors?: Record<string, string[]> } | null;
      if (previous) {
        setHours((prev) => prev.map((h) => (h.weekday === weekday ? previous : h)));
      }
      setRowErrors((prev) => ({
        ...prev,
        [weekday]: body?.errors?.opens_at[0] ?? "Nie udało się zapisać godzin pracy.",
      }));
    }
  }

  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
        <Clock size={16} />
        Godziny pracy
      </div>
      <div className="space-y-2">
        {DISPLAY_ORDER.map((weekday) => {
          const row = hours.find((h) => h.weekday === weekday);
          if (!row) return null;
          return (
            <WorkingHoursRowItem
              key={weekday}
              label={WEEKDAY_LABELS[weekday]}
              row={row}
              isPending={pendingWeekday === weekday}
              error={rowErrors[weekday]}
              onSave={(draft) => save(weekday, draft)}
            />
          );
        })}
      </div>
    </div>
  );
}

function WorkingHoursRowItem({
  label,
  row,
  isPending,
  error,
  onSave,
}: {
  label: string;
  row: WorkingHoursRow;
  isPending: boolean;
  error?: string;
  onSave: (draft: { opens_at: string | null; closes_at: string | null; is_closed: boolean }) => void;
}) {
  const [isClosed, setIsClosed] = useState(row.is_closed);
  const [opensAt, setOpensAt] = useState(toTimeInputValue(row.opens_at));
  const [closesAt, setClosesAt] = useState(toTimeInputValue(row.closes_at));

  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <input
            type="checkbox"
            checked={isClosed}
            onChange={(e) => {
              setIsClosed(e.target.checked);
            }}
          />
          Zamknięte
        </label>
      </div>
      {!isClosed && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="time"
            value={opensAt}
            onChange={(e) => {
              setOpensAt(e.target.value);
            }}
            className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-900"
          />
          <span className="text-xs font-semibold text-slate-400">–</span>
          <input
            type="time"
            value={closesAt}
            onChange={(e) => {
              setClosesAt(e.target.value);
            }}
            className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-900"
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            onSave({ opens_at: isClosed ? null : opensAt, closes_at: isClosed ? null : closesAt, is_closed: isClosed });
          }}
          className={cn(
            "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-900 disabled:opacity-50",
          )}
        >
          Zapisz
        </button>
        {error && <span className="text-xs font-semibold text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
