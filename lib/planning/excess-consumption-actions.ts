"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { materialExcessPlanInput, fabricConsumptionInput } from "./excess-consumption-types";
import type { MaterialExcessPlanInput, FabricConsumptionInput } from "./excess-consumption-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/planning"); revalidatePath("/planning/material-excess-plan"); revalidatePath("/planning/fabric-consumption"); }

// ---------------------------------------------------------------------------
// Material Excess Plan
// ---------------------------------------------------------------------------

function calcAllowed(qty: number, allowanceType: string | null, allowanceValue: number): number {
  if (!allowanceType || allowanceValue === 0) return qty;
  if (allowanceType === "pct") return Math.round(qty * (1 + allowanceValue / 100) * 1000) / 1000;
  return Math.round((qty + allowanceValue) * 1000) / 1000;
}

export async function createMaterialExcessPlan(data: MaterialExcessPlanInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = materialExcessPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("material_excess_plans").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("material_excess_plan_items").insert(
      items.map((item, i) => ({
        excess_plan_id: row.id, sno: i + 1,
        ...item,
        allowed_to_order: calcAllowed(item.qty_for_plan ?? 0, item.allowance_type_order ?? null, item.allowance_value_order ?? 0),
        allowed_to_issue: calcAllowed(item.qty_for_plan ?? 0, item.allowance_type_issue ?? null, item.allowance_value_issue ?? 0),
        allowed_to_receive: calcAllowed(item.qty_for_plan ?? 0, item.allowance_type_receive ?? null, item.allowance_value_receive ?? 0),
      })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addExcessPlanItem(planId: string, data: {
  item_class_name?: string | null; description?: string | null; uom_id?: string | null;
  qty_for_plan?: number; allowance_type_order?: string | null; allowance_value_order?: number;
  allowance_type_issue?: string | null; allowance_value_issue?: number;
  allowance_type_receive?: string | null; allowance_value_receive?: number;
}): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("material_excess_plan_items").select("sno").eq("excess_plan_id", planId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const qty = data.qty_for_plan ?? 0;
  const { data: row, error } = await s.from("material_excess_plan_items").insert({
    excess_plan_id: planId, sno, ...data,
    allowed_to_order: calcAllowed(qty, data.allowance_type_order ?? null, data.allowance_value_order ?? 0),
    allowed_to_issue: calcAllowed(qty, data.allowance_type_issue ?? null, data.allowance_value_issue ?? 0),
    allowed_to_receive: calcAllowed(qty, data.allowance_type_receive ?? null, data.allowance_value_receive ?? 0),
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteMaterialExcessPlan(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("material_excess_plans").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fabric Consumption
// ---------------------------------------------------------------------------

export async function createFabricConsumption(data: FabricConsumptionInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = fabricConsumptionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines, ...header } = p.data;
  const { data: row, error } = await s.from("fabric_consumption_records").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (lines.length > 0) {
    const { error: childErr } = await s.from("fabric_consumption_lines").insert(
      lines.map((line, i) => ({ consumption_id: row.id, sno: i + 1, ...line })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addFabricConsumptionLine(consumptionId: string, data: {
  fabric_name?: string | null; structure_name?: string | null; component?: string | null;
  coordinate?: string | null; fabric_color?: string | null; gsm?: number | null;
  uom_id?: string | null; consumption_qty?: number; consumption_wt?: number;
}): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("fabric_consumption_lines").select("sno").eq("consumption_id", consumptionId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("fabric_consumption_lines").insert({ consumption_id: consumptionId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteFabricConsumption(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("fabric_consumption_records").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
