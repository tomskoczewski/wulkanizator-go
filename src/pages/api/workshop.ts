import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { workshopDetailsSchema } from "@/lib/schemas/workshop-setup";
import { updateWorkshopDetails } from "@/lib/services/workshop-setup";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = workshopDetailsSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ errors: flattenError(parsed.error).fieldErrors }), { status: 400 });
  }

  try {
    const workshop = await updateWorkshopDetails(locals.supabase, parsed.data);
    return new Response(JSON.stringify(workshop), { status: 200 });
  } catch (error) {
    console.error("Failed to update workshop details", error);
    return new Response(JSON.stringify({ error: "Failed to update workshop" }), { status: 500 });
  }
};
