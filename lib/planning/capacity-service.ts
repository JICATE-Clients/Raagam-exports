import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CapacityPlan, ProductionPlan } from "./capacity-types";

export async function listCapacityPlans(): Promise<CapacityPlan[]> {
  const s = await createClient();
  const { data } = await s.from("capacity_plans").select("*").order("created_at", { ascending: false });
  return (data ?? []) as CapacityPlan[];
}

export async function listProductionPlans(): Promise<ProductionPlan[]> {
  const s = await createClient();
  const { data } = await s.from("production_plans").select("*").order("created_at", { ascending: false });
  return (data ?? []) as ProductionPlan[];
}
