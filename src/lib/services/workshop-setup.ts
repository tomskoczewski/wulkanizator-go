import type { TypedSupabaseClient } from "@/lib/supabase";
import type {
  BayCreateInput,
  BayUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  WorkingHoursUpdateInput,
  WorkshopDetailsInput,
} from "@/lib/schemas/workshop-setup";
import type { WorkshopConfiguration } from "@/types";

/**
 * RLS scopes every query below to the caller's own workshop via `current_workshop_id()` —
 * no function here accepts a `workshop_id` parameter. Inserts resolve it through the same RPC
 * (granted to `authenticated`, see `20260814235519_role_and_workshop_scope.sql`) since the
 * column itself carries no default.
 */
export async function getWorkshopConfiguration(supabase: TypedSupabaseClient): Promise<WorkshopConfiguration> {
  const [workshopResult, baysResult, servicesResult, hoursResult] = await Promise.all([
    supabase.from("workshops").select("*").single(),
    supabase.from("bays").select("*").eq("is_active", true).order("created_at"),
    supabase.from("services").select("*").eq("is_active", true).order("created_at"),
    supabase.from("working_hours").select("*").order("weekday"),
  ]);

  if (workshopResult.error) throw workshopResult.error;
  if (baysResult.error) throw baysResult.error;
  if (servicesResult.error) throw servicesResult.error;
  if (hoursResult.error) throw hoursResult.error;

  return {
    workshop: workshopResult.data,
    bays: baysResult.data,
    services: servicesResult.data,
    workingHours: hoursResult.data,
  };
}

export async function updateWorkshopDetails(supabase: TypedSupabaseClient, input: WorkshopDetailsInput) {
  const workshopId = await currentWorkshopId(supabase);
  const { data, error } = await supabase
    .from("workshops")
    .update({ name: input.name, phone: input.phone ?? null, address: input.address ?? null })
    .eq("id", workshopId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function currentWorkshopId(supabase: TypedSupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_workshop_id");
  if (error) throw error;
  return data;
}

export async function createBay(supabase: TypedSupabaseClient, input: BayCreateInput) {
  const workshopId = await currentWorkshopId(supabase);
  const { data, error } = await supabase
    .from("bays")
    .insert({ workshop_id: workshopId, name: input.name, vehicle_type: input.vehicle_type ?? null })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBay(supabase: TypedSupabaseClient, id: string, input: BayUpdateInput) {
  const { data, error } = await supabase.from("bays").update(input).eq("id", id).select().maybeSingle();

  if (error) throw error;
  return data;
}

export async function createService(supabase: TypedSupabaseClient, input: ServiceCreateInput) {
  const workshopId = await currentWorkshopId(supabase);
  const { data, error } = await supabase
    .from("services")
    .insert({ workshop_id: workshopId, name: input.name, duration_min: input.duration_min })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateService(supabase: TypedSupabaseClient, id: string, input: ServiceUpdateInput) {
  const { data, error } = await supabase.from("services").update(input).eq("id", id).select().maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateWorkingHours(
  supabase: TypedSupabaseClient,
  weekday: number,
  input: WorkingHoursUpdateInput,
) {
  const { data, error } = await supabase
    .from("working_hours")
    .update({
      opens_at: input.is_closed ? null : (input.opens_at ?? null),
      closes_at: input.is_closed ? null : (input.closes_at ?? null),
      is_closed: input.is_closed,
    })
    .eq("weekday", weekday)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}
