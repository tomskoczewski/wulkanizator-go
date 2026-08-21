import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { appointmentBookingRequestSchema } from "@/lib/schemas/appointment";
import { bookAppointment, toWireSlot } from "@/lib/services/appointments";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = appointmentBookingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const outcome = await bookAppointment(locals.supabase, parsed.data);

    if (outcome.status === "conflict") {
      // Never forward the raw exclusion-constraint DETAIL — it names the conflicting row's key and
      // is produced before RLS filtering, so it can leak another workshop's data.
      return Response.json(
        {
          error: "Ten termin został właśnie zajęty",
          slots: outcome.slots.map(toWireSlot),
          emptyReason: outcome.emptyReason,
        },
        { status: 409 },
      );
    }

    return Response.json(outcome.appointment, { status: 201 });
  } catch (error) {
    console.error("Failed to book appointment", error);
    return Response.json({ error: "Failed to book appointment" }, { status: 500 });
  }
};
