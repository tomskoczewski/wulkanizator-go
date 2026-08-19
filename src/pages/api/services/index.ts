import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { serviceCreateSchema } from "@/lib/schemas/workshop-setup";
import { createService } from "@/lib/services/workshop-setup";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = serviceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ errors: flattenError(parsed.error).fieldErrors }), { status: 400 });
  }

  try {
    const service = await createService(locals.supabase, parsed.data);
    return new Response(JSON.stringify(service), { status: 201 });
  } catch (error) {
    console.error("Failed to create service", error);
    return new Response(JSON.stringify({ error: "Failed to create service" }), { status: 500 });
  }
};
