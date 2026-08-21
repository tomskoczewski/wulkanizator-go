import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { bayCreateSchema } from "@/lib/schemas/workshop-setup";
import { createBay } from "@/lib/services/workshop-setup";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bayCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const bay = await createBay(locals.supabase, parsed.data);
    return Response.json(bay, { status: 201 });
  } catch (error) {
    console.error("Failed to create bay", error);
    return Response.json({ error: "Failed to create bay" }, { status: 500 });
  }
};
