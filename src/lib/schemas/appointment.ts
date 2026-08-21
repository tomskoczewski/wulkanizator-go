import { z } from "zod";

// Naive workshop-local wall-clock, matching `naiveDateToTimestampString()` in workshop-clock.ts.
// Validated with a regex rather than `z.coerce.date()`, which would apply UTC parsing semantics to
// a value that carries no timezone.
const STARTS_AT_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const slotSuggestionRequestSchema = z.object({
  service_id: z.string().trim().pipe(z.uuid("Nieprawidłowy identyfikator usługi")),
});

export const appointmentBookingRequestSchema = z.object({
  service_id: z.string().trim().pipe(z.uuid("Nieprawidłowy identyfikator usługi")),
  bay_id: z.string().trim().pipe(z.uuid("Nieprawidłowy identyfikator stanowiska")),
  starts_at: z.string().trim().regex(STARTS_AT_PATTERN, "Nieprawidłowy format czasu"),
  first_name: z.string().trim().min(1, "Imię klienta jest wymagane"),
  phone: z.string().trim().min(1, "Telefon jest wymagany"),
});

export type SlotSuggestionRequestInput = z.infer<typeof slotSuggestionRequestSchema>;
export type AppointmentBookingRequestInput = z.infer<typeof appointmentBookingRequestSchema>;
