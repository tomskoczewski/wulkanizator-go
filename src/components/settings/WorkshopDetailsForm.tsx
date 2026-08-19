import { useState, type SubmitEvent } from "react";
import { cn } from "@/lib/utils";
import { useJsonMutation } from "@/components/hooks/useJsonMutation";
import type { Workshop } from "@/types";

interface Props {
  workshop: Workshop;
  onSaved: (workshop: Workshop) => void;
}

const inputClass = "w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900";

export function WorkshopDetailsForm({ workshop, onSaved }: Props) {
  const [name, setName] = useState(workshop.name);
  const [phone, setPhone] = useState(workshop.phone ?? "");
  const [address, setAddress] = useState(workshop.address ?? "");
  const { mutate, error, isPending } = useJsonMutation<Workshop>();

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await mutate("/api/workshop", "PATCH", {
      name,
      phone: phone.trim() || null,
      address: address.trim() || null,
    });

    if (result) {
      onSaved(result);
      setName(result.name);
      setPhone(result.phone ?? "");
      setAddress(result.address ?? "");
    } else {
      setName(workshop.name);
      setPhone(workshop.phone ?? "");
      setAddress(workshop.address ?? "");
    }
  }

  const nameError = error?.fieldErrors?.name[0];

  return (
    <form onSubmit={handleSubmit} className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 text-sm font-black text-slate-900">Dane warsztatu</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-black text-slate-900">Nazwa</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className={cn(inputClass, nameError && "border-rose-400")}
          />
          {nameError && <span className="mt-1 block text-xs font-semibold text-rose-600">{nameError}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-black text-slate-900">Telefon</span>
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-black text-slate-900">Adres</span>
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
            }}
            className={inputClass}
          />
        </label>
      </div>
      {error?.message && !nameError && <p className="mt-2 text-xs font-semibold text-rose-600">{error.message}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        Zapisz
      </button>
    </form>
  );
}
