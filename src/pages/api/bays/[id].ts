import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { bayUpdateSchema } from "@/lib/schemas/workshop-setup";
import { updateBay } from "@/lib/services/workshop-setup";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  if (!locals.supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 503 });
  }

  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing bay id" }), { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bayUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ errors: flattenError(parsed.error).fieldErrors }), { status: 400 });
  }

  try {
    const bay = await updateBay(locals.supabase, id, parsed.data);
    return new Response(JSON.stringify(bay), { status: 200 });
  } catch (error) {
    console.error("Failed to update bay", error);
    return new Response(JSON.stringify({ error: "Failed to update bay" }), { status: 500 });
  }
};
