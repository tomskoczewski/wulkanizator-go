import { useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRowMutation } from "@/components/hooks/useJsonMutation";
import type { WorkingHours as WorkingHoursRow } from "@/types";

interface Props {
  initialHours: WorkingHoursRow[];
}

interface HoursDraft {
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
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

function toDraft(row: WorkingHoursRow): HoursDraft {
  return {
    opensAt: toTimeInputValue(row.opens_at),
    closesAt: toTimeInputValue(row.closes_at),
    isClosed: row.is_closed,
  };
}

function toDraftMap(rows: WorkingHoursRow[]): Record<number, HoursDraft | undefined> {
  return Object.fromEntries(rows.map((row) => [row.weekday, toDraft(row)]));
}

export function WorkingHours({ initialHours }: Props) {
  const [hours, setHours] = useState(initialHours);
  // The edit draft lives here, next to the server truth it is derived from. Holding it inside the
  // row component instead would leave the inputs showing rejected values after a failed save: the
  // row never re-mounts, so a parent revert would never reach it.
  const [drafts, setDrafts] = useState<Record<number, HoursDraft | undefined>>(() => toDraftMap(initialHours));
  const { run, isPending, rowErrors } = useRowMutation();

  function updateDraft(weekday: number, patch: Partial<HoursDraft>) {
    setDrafts((prev) => {
      const current = prev[weekday];
      if (!current) return prev;
      return { ...prev, [weekday]: { ...current, ...patch } };
    });
  }

  async function save(weekday: number) {
    const draft = drafts[weekday];
    if (!draft) return;
    const previous = hours.find((h) => h.weekday === weekday);
    const body = {
      opens_at: draft.isClosed ? null : draft.opensAt,
      closes_at: draft.isClosed ? null : draft.closesAt,
      is_closed: draft.isClosed,
    };

    setHours((prev) => prev.map((h) => (h.weekday === weekday ? { ...h, ...body } : h)));

    await run(
      String(weekday),
      { url: `/api/working-hours/${weekday}`, method: "PUT", body },
      {
        rollback: () => {
          if (!previous) return;
          setHours((prev) => prev.map((h) => (h.weekday === weekday ? previous : h)));
          setDrafts((prev) => ({ ...prev, [weekday]: toDraft(previous) }));
        },
        fallbackMessage: "Nie udało się zapisać godzin pracy.",
      },
    );
  }

  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
        <Clock size={16} />
        Godziny pracy
      </div>
      <div className="space-y-2">
        {DISPLAY_ORDER.map((weekday) => {
          const draft = drafts[weekday];
          if (!draft) return null;
          return (
            <WorkingHoursRowItem
              key={weekday}
              label={WEEKDAY_LABELS[weekday]}
              draft={draft}
              isPending={isPending(String(weekday))}
              error={rowErrors[String(weekday)]}
              onChange={(patch) => {
                updateDraft(weekday, patch);
              }}
              onSave={() => void save(weekday)}
            />
          );
        })}
      </div>
    </div>
  );
}

function WorkingHoursRowItem({
  label,
  draft,
  isPending,
  error,
  onChange,
  onSave,
}: {
  label: string;
  draft: HoursDraft;
  isPending: boolean;
  error?: string;
  onChange: (patch: Partial<HoursDraft>) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <input
            type="checkbox"
            checked={draft.isClosed}
            onChange={(e) => {
              onChange({ isClosed: e.target.checked });
            }}
          />
          Zamknięte
        </label>
      </div>
      {!draft.isClosed && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="time"
            value={draft.opensAt}
            onChange={(e) => {
              onChange({ opensAt: e.target.value });
            }}
            className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-900"
          />
          <span className="text-xs font-semibold text-slate-400">–</span>
          <input
            type="time"
            value={draft.closesAt}
            onChange={(e) => {
              onChange({ closesAt: e.target.value });
            }}
            className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-900"
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={onSave}
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
