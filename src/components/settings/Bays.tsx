import { useState, type SubmitEvent } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJsonMutation, useRowMutation } from "@/components/hooks/useJsonMutation";
import type { Bay } from "@/types";

interface Props {
  initialBays: Bay[];
}

export function Bays({ initialBays }: Props) {
  const [bays, setBays] = useState(initialBays);
  const [showAddForm, setShowAddForm] = useState(false);
  const { run, isPending, rowErrors } = useRowMutation();

  async function deactivate(bay: Bay) {
    // Capture the position, not the list: rolling back to a whole-list snapshot would resurrect a
    // different bay that was deactivated successfully while this request was in flight.
    const index = bays.findIndex((b) => b.id === bay.id);
    setBays((prev) => prev.filter((b) => b.id !== bay.id));

    await run(
      bay.id,
      { url: `/api/bays/${bay.id}`, method: "PATCH", body: { is_active: false } },
      {
        rollback: () => {
          setBays((prev) => {
            if (prev.some((b) => b.id === bay.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(index, next.length), 0, bay);
            return next;
          });
        },
        fallbackMessage: "Nie udało się usunąć stanowiska.",
      },
    );
  }

  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
        <Building2 size={16} />
        Stanowiska
      </div>
      {bays.map((bay) => (
        <div key={bay.id} className="mb-2 rounded-xl bg-slate-50 p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
            <span>
              {bay.name}
              {bay.vehicle_type ? ` · ${bay.vehicle_type}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void deactivate(bay)}
              disabled={isPending(bay.id)}
              title="Usuń stanowisko"
              className="rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          {rowErrors[bay.id] && (
            <span className="mt-1 block text-xs font-semibold text-rose-600">{rowErrors[bay.id]}</span>
          )}
        </div>
      ))}
      {showAddForm ? (
        <AddBayForm
          onCancel={() => {
            setShowAddForm(false);
          }}
          onAdded={(bay) => {
            setBays((prev) => [...prev, bay]);
            setShowAddForm(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowAddForm(true);
          }}
          className="mt-2 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-black text-white"
        >
          Dodaj stanowisko
        </button>
      )}
    </div>
  );
}

function AddBayForm({ onAdded, onCancel }: { onAdded: (bay: Bay) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const { mutate, error, isPending } = useJsonMutation<Bay>();

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await mutate("/api/bays", "POST", { name, vehicle_type: vehicleType.trim() || null });
    if (result) onAdded(result);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 rounded-xl border border-slate-200 p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-black text-slate-900">Nazwa stanowiska</span>
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
        <span className="mb-1 block text-xs font-black text-slate-900">Typ pojazdu</span>
        <input
          value={vehicleType}
          onChange={(e) => {
            setVehicleType(e.target.value);
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
