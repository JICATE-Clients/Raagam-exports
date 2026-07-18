import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MaterialExcessPlan, MaterialExcessPlanItem, FabricConsumptionRecord, FabricConsumptionLine } from "./excess-consumption-types";

export type MaterialExcessPlanRow = MaterialExcessPlan & { buyer_name: string | null };

export async function listMaterialExcessPlans(): Promise<MaterialExcessPlanRow[]> {
  const s = await createClient();
  const { data } = await s.from("material_excess_plans").select("*, buyers:customer_id(name)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, buyer_name: (row.buyers as { name: string } | null)?.name ?? null } as unknown as MaterialExcessPlanRow;
  });
}

export async function getMaterialExcessPlanItems(planId: string): Promise<MaterialExcessPlanItem[]> {
  const s = await createClient();
  const { data } = await s.from("material_excess_plan_items").select("*").eq("excess_plan_id", planId).order("sno");
  return (data ?? []) as MaterialExcessPlanItem[];
}

export async function listFabricConsumptions(): Promise<FabricConsumptionRecord[]> {
  const s = await createClient();
  const { data } = await s.from("fabric_consumption_records").select("*").order("created_at", { ascending: false });
  return (data ?? []) as FabricConsumptionRecord[];
}

export async function getFabricConsumptionLines(consumptionId: string): Promise<FabricConsumptionLine[]> {
  const s = await createClient();
  const { data } = await s.from("fabric_consumption_lines").select("*").eq("consumption_id", consumptionId).order("sno");
  return (data ?? []) as FabricConsumptionLine[];
}
