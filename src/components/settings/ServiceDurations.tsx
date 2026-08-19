import { useState, type SubmitEvent } from "react";
import { AlertCircle, CircleDot, Plus, Settings, Timer, Trash2, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJsonMutation } from "@/components/hooks/useJsonMutation";
import type { Service } from "@/types";

interface Props {
  initialServices: Service[];
}

const SERVICE_ICONS: Record<string, LucideIcon> = {
  "Wymiana kół": Wrench,
  "Wymiana opon": CircleDot,
  "Wymiana + wyważanie": Timer,
  Wyważanie: Settings,
  "Naprawa ogumienia": AlertCircle,
  Utylizacja: Trash2,
};
const DEFAULT_ICON = Wrench;

const DURATION_STEP = 5;
const DURATION_FLOOR = 5;

export function ServiceDurations({ initialServices }: Props) {
  const [services, setServices] = useState(initialServices);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 text-sm font-black text-slate-900">Czasy usług</div>
      <div className="space-y-2">
        {services.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            isPending={pendingId === service.id}
            error={rowErrors[service.id]}
            onAdjust={(delta) => adjustDuration(service, delta)}
            onDeactivate={() => deactivate(service)}
          />
        ))}
      </div>
      {showAddForm ? (
        <AddServiceForm
          onCancel={() => {
            setShowAddForm(false);
          }}
          onAdded={(service) => {
            setServices((prev) => [...prev, service]);
            setShowAddForm(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowAddForm(true);
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-xs font-black text-slate-600"
        >
          <Plus size={15} /> Dodaj własną usługę
        </button>
      )}
    </div>
  );

  async function adjustDuration(service: Service, delta: number) {
    const nextDuration = Math.max(DURATION_FLOOR, service.duration_min + delta);
    if (nextDuration === service.duration_min) return;

    const previous = service;
    setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, duration_min: nextDuration } : s)));
    setPendingId(service.id);
    setRowErrors((prev) => ({ ...prev, [service.id]: "" }));

    const res = await fetch(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_min: nextDuration }),
    });

    setPendingId(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errors?: Record<string, string[]> } | null;
      setServices((prev) => prev.map((s) => (s.id === service.id ? previous : s)));
      setRowErrors((prev) => ({
        ...prev,
        [service.id]: body?.errors?.duration_min[0] ?? "Nie udało się zapisać czasu usługi.",
      }));
    }
  }

  async function deactivate(service: Service) {
    const previous = services;
    setServices((prev) => prev.filter((s) => s.id !== service.id));

    const res = await fetch(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });

    if (!res.ok) {
      setServices(previous);
    }
  }
}

function ServiceRow({
  service,
  isPending,
  error,
  onAdjust,
  onDeactivate,
}: {
  service: Service;
  isPending: boolean;
  error?: string;
  onAdjust: (delta: number) => void;
  onDeactivate: () => void;
}) {
  const Icon = SERVICE_ICONS[service.name] ?? DEFAULT_ICON;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white p-2 shadow-sm">
            <Icon size={17} className="text-slate-600" />
          </div>
          <div>
            <div className="text-xs font-black text-slate-900">{service.name}</div>
            <div className="text-xs font-semibold text-slate-500">Domyślny czas</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onAdjust(-DURATION_STEP);
            }}
            disabled={isPending}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black disabled:opacity-50"
          >
            −
          </button>
          <div className="w-20 rounded-xl bg-white px-3 py-1.5 text-center text-xs font-black text-slate-900 shadow-sm">
            {service.duration_min} min
          </div>
          <button
            type="button"
            onClick={() => {
              onAdjust(DURATION_STEP);
            }}
            disabled={isPending}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black disabled:opacity-50"
          >
            +
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            title="Usuń usługę"
            className="rounded-xl px-2 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100"
          >
            ✕
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}

function AddServiceForm({ onAdded, onCancel }: { onAdded: (service: Service) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const { mutate, error, isPending } = useJsonMutation<Service>();

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await mutate("/api/services", "POST", { name, duration_min: durationMin });
    if (result) onAdded(result);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2 rounded-xl border border-slate-200 p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-black text-slate-900">Nazwa usługi</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className={cn(
            "w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900",
            error?.fieldErrors?.name && "border-rose-400",
          )}
        />
        {error?.fieldErrors?.name && (
          <span className="mt-1 block text-xs font-semibold text-rose-600">{error.fieldErrors.name[0]}</span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-black text-slate-900">Czas (min)</span>
        <input
          type="number"
          min={1}
          value={durationMin}
          onChange={(e) => {
            setDurationMin(Number(e.target.value));
          }}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
        >
          Dodaj
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-3 py-1.5 text-xs font-black text-slate-600">
          Anuluj
        </button>
      </div>
    </form>
  );
}
