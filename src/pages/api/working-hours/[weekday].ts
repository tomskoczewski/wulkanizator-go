import type { APIRoute } from "astro";
import { flattenError } from "zod";
import { workingHoursUpdateSchema } from "@/lib/schemas/workshop-setup";
import { updateWorkingHours } from "@/lib/services/workshop-setup";

export const prerender = false;

export const PUT: APIRoute = async ({ request, locals, params }) => {
  if (!locals.supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 503 });
  }

  const weekday = Number(params.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return new Response(JSON.stringify({ error: "Invalid weekday" }), { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = workingHoursUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ errors: flattenError(parsed.error).fieldErrors }), { status: 400 });
  }

  try {
    const hours = await updateWorkingHours(locals.supabase, weekday, parsed.data);
    return new Response(JSON.stringify(hours), { status: 200 });
  } catch (error) {
    console.error("Failed to update working hours", error);
    return new Response(JSON.stringify({ error: "Failed to update working hours" }), { status: 500 });
  }
};
