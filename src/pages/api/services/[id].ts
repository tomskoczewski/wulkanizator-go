import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { serviceUpdateSchema } from "@/lib/schemas/workshop-setup";
import { updateService } from "@/lib/services/workshop-setup";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  if (!locals.supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const id = params.id;
  if (!id) {
    return Response.json({ error: "Missing service id" }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = serviceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const service = await updateService(locals.supabase, id, parsed.data);
    if (!service) {
      return Response.json({ error: "Service not found" }, { status: 404 });
    }
    return Response.json(service, { status: 200 });
  } catch (error) {
    console.error("Failed to update service", error);
    return Response.json({ error: "Failed to update service" }, { status: 500 });
  }
};
