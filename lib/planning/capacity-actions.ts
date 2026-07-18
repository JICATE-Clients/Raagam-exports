"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { capacityPlanInput, productionPlanInput } from "./capacity-types";
import type { CapacityPlanInput, ProductionPlanInput } from "./capacity-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/planning"); revalidatePath("/planning/capacity-planning"); revalidatePath("/planning/production-planning"); }

// Business logic: calculate days required
function calcDaysRequired(planQty: number, targetQty: number, targetEfficiency: number): number {
  if (targetQty <= 0 || targetEfficiency <= 0) return 0;
  const effectiveDaily = targetQty * (targetEfficiency / 100);
  return effectiveDaily > 0 ? Math.round((planQty / effectiveDaily) * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Capacity Planning
// ---------------------------------------------------------------------------

export async function createCapacityPlan(data: CapacityPlanInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = capacityPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { orders, ...header } = p.data;
  const { data: row, error } = await s.from("capacity_plans").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (orders.length > 0) {
    const { error: childErr } = await s.from("capacity_plan_orders").insert(
      orders.map((o, i) => ({
        capacity_plan_id: row.id, sno: i + 1, ...o,
        days_required: calcDaysRequired(o.plan_qty ?? 0, o.target_qty ?? 0, o.target_efficiency ?? 0),
      })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addCapacityPlanOrder(planId: string, data: {
  order_no?: string | null; customer_name?: string | null; style_ref_no?: string | null; style_no?: string | null;
  order_qty?: number; delivery_date?: string | null; sam?: number; target_efficiency?: number;
  target_qty?: number; plan_qty?: number; period_from?: string | null; period_to?: string | null;
  location_name?: string | null; team_name?: string | null; with_learning_curve?: boolean;
}): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("capacity_plan_orders").select("sno").eq("capacity_plan_id", planId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("capacity_plan_orders").insert({
    capacity_plan_id: planId, sno, ...data,
    days_required: calcDaysRequired(data.plan_qty ?? 0, data.target_qty ?? 0, data.target_efficiency ?? 0),
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function confirmCapacityPlan(id: string): Promise<Result> {
  if (!(await can("planning", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("capacity_plans").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCapacityPlan(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("capacity_plans").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Production Planning
// ---------------------------------------------------------------------------

export async function createProductionPlan(data: ProductionPlanInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = productionPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { orders, ...header } = p.data;
  const { data: row, error } = await s.from("production_plans").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (orders.length > 0) {
    const { error: childErr } = await s.from("production_plan_orders").insert(
      orders.map((o, i) => ({
        production_plan_id: row.id, sno: i + 1, ...o,
        days_required: calcDaysRequired(o.plan_qty ?? 0, o.target_qty ?? 0, o.target_efficiency ?? 0),
      })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addProductionPlanOrder(planId: string, data: {
  work_order_no?: string | null; order_no?: string | null; customer_name?: string | null;
  style_ref_no?: string | null; style_no?: string | null; order_qty?: number;
  delivery_date?: string | null; sam?: number; target_efficiency?: number;
  target_qty?: number; plan_qty?: number; period_from?: string | null; period_to?: string | null;
  location_name?: string | null; team_name?: string | null; with_learning_curve?: boolean;
}): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("production_plan_orders").select("sno").eq("production_plan_id", planId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("production_plan_orders").insert({
    production_plan_id: planId, sno, ...data,
    days_required: calcDaysRequired(data.plan_qty ?? 0, data.target_qty ?? 0, data.target_efficiency ?? 0),
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function confirmProductionPlan(id: string): Promise<Result> {
  if (!(await can("planning", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("production_plans").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteProductionPlan(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("production_plans").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
