import { useMemo, useState } from "react";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock,
  Settings,
  Timer,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJsonMutation } from "@/components/hooks/useJsonMutation";
import { workshopTodayDateString } from "@/lib/workshop-clock";
import type { Appointment, EmptyReason, Service, WireSlot } from "@/types";

interface Props {
  services: Service[];
}

interface SlotsResponse {
  slots: WireSlot[];
  emptyReason: EmptyReason;
}

interface BookingConflictResponse {
  error: string;
  slots: WireSlot[];
  emptyReason: EmptyReason;
}

const SERVICE_ICONS: Record<string, LucideIcon> = {
  "Wymiana kół": Wrench,
  "Wymiana opon": CircleDot,
  "Wymiana + wyważanie": Timer,
  Wyważanie: Settings,
  "Naprawa ogumienia": AlertCircle,
  Utylizacja: Trash2,
};

const EMPTY_REASON_MESSAGE: Record<Exclude<EmptyReason, null>, string> = {
  no_active_bays: "Brak aktywnych stanowisk. Sprawdź ustawienia warsztatu.",
  closed_all_week: "Warsztat jest zamknięty w najbliższych dwóch tygodniach. Sprawdź godziny pracy w ustawieniach.",
  no_slots: "Brak wolnych terminów dla tej usługi w najbliższych dwóch tygodniach.",
};

function timeLabel(wire: string): string {
  return /\d{2}:\d{2}/.exec(wire)?.[0] ?? wire;
}

function dateLabel(wire: string): string {
  const [, month, day] = wire.slice(0, 10).split("-");
  return `${day}.${month}`;
}

function fullDateLabel(wire: string): string {
  const [year, month, day] = wire.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

export default function NewAppointmentForm({ services }: Props) {
  const today = useMemo(() => workshopTodayDateString(), []);

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [slots, setSlots] = useState<WireSlot[]>([]);
  const [emptyReason, setEmptyReason] = useState<EmptyReason>(null);
  const [selectedSlot, setSelectedSlot] = useState<WireSlot | null>(null);
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Appointment | null>(null);

  const slotsMutation = useJsonMutation<SlotsResponse>();

  async function handleSelectService(serviceId: string) {
    setSelectedServiceId(serviceId);
    setSelectedSlot(null);
    setBookingError(null);

    const result = await slotsMutation.mutate("/api/appointments/slots", "POST", { service_id: serviceId });
    setSlots(result?.slots ?? []);
    setEmptyReason(result?.emptyReason ?? null);
  }

  // Hand-rolled instead of useJsonMutation: a 409 here carries slots/emptyReason alongside the
  // error, which useJsonMutation's MutationResult (ok/fieldErrors/message only) can't carry.
  async function handleSubmit() {
    if (!selectedServiceId || !selectedSlot) return;

    setIsBooking(true);
    setBookingError(null);

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: selectedServiceId,
          bay_id: selectedSlot.bayId,
          starts_at: selectedSlot.start,
          first_name: firstName.trim(),
          phone: phone.trim(),
        }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (res.status === 201) {
        setBooked(body as Appointment);
        return;
      }

      if (res.status === 409) {
        const conflict = body as BookingConflictResponse;
        setSlots(conflict.slots);
        setEmptyReason(conflict.emptyReason);
        setSelectedSlot(null);
        setBookingError(conflict.error);
        return;
      }

      setBookingError("Coś poszło nie tak. Spróbuj ponownie.");
    } catch {
      setBookingError("Nie udało się połączyć z serwerem.");
    } finally {
      setIsBooking(false);
    }
  }

  function resetForm() {
    setBooked(null);
    setSelectedServiceId(null);
    setSelectedSlot(null);
    setSlots([]);
    setEmptyReason(null);
    setFirstName("");
    setPhone("");
    setBookingError(null);
  }

  if (booked) {
    return (
      <div className="mx-auto max-w-2xl rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
          <CheckCircle2 size={18} />
          Wizyta zapisana
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-700">
          {fullDateLabel(booked.starts_at)}, {timeLabel(booked.starts_at)}–{timeLabel(booked.ends_at)}
        </p>
        <button
          type="button"
          onClick={resetForm}
          className="mt-4 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-white"
        >
          Dodaj kolejną wizytę
        </button>
      </div>
    );
  }

  const canSubmit = Boolean(selectedServiceId && selectedSlot && firstName.trim() && phone.trim());

  return (
    <div className="mx-auto max-w-2xl rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Nowa wizyta</h2>
          <p className="text-xs font-medium text-slate-500">Tylko najważniejsze pola, bez zbędnego klikania.</p>
        </div>
        {selectedSlot && (
          <div className="rounded-xl bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700">
            {timeLabel(selectedSlot.start)}–{timeLabel(selectedSlot.end)}
          </div>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
        <div className="flex items-center gap-2 text-xs font-black text-orange-800">
          <Bell size={14} />
          System podpowiada najbliższe wolne terminy
        </div>

        {!selectedServiceId && (
          <p className="mt-2 text-xs font-semibold text-orange-700">
            Wybierz usługę, aby zobaczyć propozycje terminów.
          </p>
        )}

        {selectedServiceId && slotsMutation.isPending && (
          <p className="mt-2 text-xs font-semibold text-orange-700">Szukam wolnych terminów…</p>
        )}

        {selectedServiceId && !slotsMutation.isPending && slots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {slots.map((slot) => {
              const isSelected = selectedSlot?.bayId === slot.bayId && selectedSlot.start === slot.start;
              return (
                <button
                  key={`${slot.bayId}-${slot.start}`}
                  type="button"
                  onClick={() => {
                    setSelectedSlot(slot);
                  }}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-xs font-black",
                    isSelected ? "bg-orange-500 text-white" : "bg-white text-orange-700",
                  )}
                >
                  {timeLabel(slot.start)}
                  {slot.start.slice(0, 10) !== today && (
                    <span className="ml-1 opacity-75">{dateLabel(slot.start)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selectedServiceId && !slotsMutation.isPending && slots.length === 0 && (
          <p className="mt-2 text-xs font-semibold text-orange-700">
            {emptyReason
              ? EMPTY_REASON_MESSAGE[emptyReason]
              : (slotsMutation.error?.message ?? "Brak wolnych terminów.")}
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-700">Godzina</span>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <Clock size={15} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-900">
              {selectedSlot ? `${timeLabel(selectedSlot.start)}–${timeLabel(selectedSlot.end)}` : "Wybierz termin"}
            </span>
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-700">Telefon</span>
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            placeholder="np. 500 600 700"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-700">Klient</span>
          <input
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
            }}
            placeholder="Imię klienta"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-black text-slate-700">Wybierz usługę</div>
        <div className="grid gap-2 md:grid-cols-3">
          {services.map((service) => {
            const Icon = SERVICE_ICONS[service.name] ?? Wrench;
            const isSelected = service.id === selectedServiceId;
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => void handleSelectService(service.id)}
                className={cn(
                  "rounded-xl border p-3 text-left shadow-sm",
                  isSelected ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white",
                )}
              >
                <Icon size={18} className={isSelected ? "text-orange-600" : "text-slate-500"} />
                <div className="mt-2 text-xs font-black text-slate-900">{service.name}</div>
                <div className="mt-0.5 text-xs font-bold text-slate-500">{service.duration_min} min</div>
              </button>
            );
          })}
        </div>
      </div>

      {bookingError && <p className="mt-4 text-xs font-semibold text-rose-600">{bookingError}</p>}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit || isBooking}
        className="mt-4 w-full rounded-xl bg-orange-500 py-3 text-sm font-black text-white shadow-sm disabled:opacity-50"
      >
        Zapisz wizytę
      </button>
    </div>
  );
}
