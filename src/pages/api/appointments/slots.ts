import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { slotSuggestionRequestSchema } from "@/lib/schemas/appointment";
import { suggestSlotsForService, toWireSlot } from "@/lib/services/appointments";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = slotSuggestionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const result = await suggestSlotsForService(locals.supabase, parsed.data.service_id);
    return Response.json({ slots: result.slots.map(toWireSlot), emptyReason: result.emptyReason }, { status: 200 });
  } catch (error) {
    console.error("Failed to suggest slots", error);
    return Response.json({ error: "Failed to suggest slots" }, { status: 500 });
  }
};
