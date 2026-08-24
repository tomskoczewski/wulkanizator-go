import type { APIRoute } from "astro";
import { z, flattenError } from "zod";
import { appointmentStatusChangeSchema } from "@/lib/schemas/appointment";
import { changeAppointmentStatus } from "@/lib/services/appointments";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  if (!locals.supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const idResult = z.uuid().safeParse(params.id);
  if (!idResult.success) {
    return Response.json({ error: "Nieprawidłowy identyfikator wizyty" }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = appointmentStatusChangeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const outcome = await changeAppointmentStatus(locals.supabase, idResult.data, parsed.data);

    switch (outcome.status) {
      case "updated":
        return Response.json(outcome.entry ?? { id: idResult.data, status: outcome.current }, { status: 200 });
      case "stale":
        return Response.json(
          { error: "Ktoś inny właśnie zmienił status tej wizyty", current: outcome.current },
          { status: 409 },
        );
      case "slot_taken":
        // Never forward the raw exclusion-constraint DETAIL — see appointments/index.ts.
        return Response.json({ error: "Ten termin został właśnie zajęty" }, { status: 409 });
      case "not_found":
        return Response.json({ error: "Nie znaleziono wizyty" }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Illegal status transition")) {
      return Response.json({ errors: { status: ["Niedozwolona zmiana statusu"] } }, { status: 400 });
    }
    console.error("Failed to change appointment status", error);
    return Response.json({ error: "Failed to change appointment status" }, { status: 500 });
  }
};
