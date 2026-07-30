"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  capacityPlanInputSchema,
  productionPlanInputSchema,
} from "./production-planning-types";
import type {
  CapacityPlanInput,
  ProductionPlanInput,
} from "./production-planning-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidatePp(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
}

// ============================================================================
// 1. CAPACITY PLANNING — Header CRUD
// ============================================================================

export async function createCapacityPlan(
  data: CapacityPlanInput,
): Promise<{ ok: true; planId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = capacityPlanInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { orders, ...header } = parsed.data;

  const { data: plan, error } = await supabase
    .from("capacity_plans")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !plan) return { ok: false, error: error?.message ?? "Failed" };
  const planId = plan.id;

  for (const order of orders) {
    const { details, ...orderData } = order;
    const { data: orderRow } = await supabase
      .from("capacity_plan_orders")
      .insert({ ...orderData, id: undefined, capacity_plan_id: planId })
      .select("id")
      .single();
    if (!orderRow) continue;

    if (details.length > 0) {
      await supabase
        .from("capacity_plan_details")
        .insert(details.map((d) => ({ ...d, id: undefined, order_id: orderRow.id })));
    }
  }

  revalidatePp("/planning/capacity-planning");
  return { ok: true, planId };
}

export async function updateCapacityPlan(
  id: string,
  data: Partial<CapacityPlanInput>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { orders: _orders, ...header } = data;

  const { error } = await supabase
    .from("capacity_plans")
    .update(header)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePp(`/planning/capacity-planning/${id}`, "/planning/capacity-planning");
  return { ok: true };
}

export async function deleteCapacityPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plans").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp("/planning/capacity-planning");
  return { ok: true };
}

export async function submitCapacityPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("capacity_plans")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${id}`, "/planning/capacity-planning");
  return { ok: true };
}

export async function approveCapacityPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("capacity_plans")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "capacity_plan.approved", entityType: "capacity_plan", entityId: id });
  revalidatePp(`/planning/capacity-planning/${id}`, "/planning/capacity-planning");
  return { ok: true };
}

// ============================================================================
// CAPACITY PLANNING — Child Row CRUD: Orders
// ============================================================================

export async function addCapacityPlanOrder(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_orders").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${data.capacity_plan_id}`);
  return { ok: true };
}

export async function updateCapacityPlanOrder(
  id: string, planId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_orders").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${planId}`);
  return { ok: true };
}

export async function deleteCapacityPlanOrder(
  id: string, planId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${planId}`);
  return { ok: true };
}

// ============================================================================
// CAPACITY PLANNING — Child Row CRUD: Details
// ============================================================================

export async function addCapacityPlanDetail(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_details").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${data.capacity_plan_id}`);
  return { ok: true };
}

export async function updateCapacityPlanDetail(
  id: string, planId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_details").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${planId}`);
  return { ok: true };
}

export async function deleteCapacityPlanDetail(
  id: string, planId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("capacity_plan_details").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/capacity-planning/${planId}`);
  return { ok: true };
}

// ============================================================================
// 2. PRODUCTION PLANNING — Header CRUD
// ============================================================================

export async function createProductionPlan(
  data: ProductionPlanInput,
): Promise<{ ok: true; planId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = productionPlanInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { orders, ...header } = parsed.data;

  const { data: plan, error } = await supabase
    .from("production_plans")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !plan) return { ok: false, error: error?.message ?? "Failed" };
  const planId = plan.id;

  for (const order of orders) {
    const { details, ...orderData } = order;
    const { data: orderRow } = await supabase
      .from("production_plan_orders")
      .insert({ ...orderData, id: undefined, production_plan_id: planId })
      .select("id")
      .single();
    if (!orderRow) continue;

    if (details.length > 0) {
      await supabase
        .from("production_plan_details")
        .insert(details.map((d) => ({ ...d, id: undefined, order_id: orderRow.id })));
    }
  }

  revalidatePp("/planning/production-planning");
  return { ok: true, planId };
}

export async function updateProductionPlan(
  id: string,
  data: Partial<ProductionPlanInput>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { orders: _orders, ...header } = data;

  const { error } = await supabase
    .from("production_plans")
    .update(header)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePp(`/planning/production-planning/${id}`, "/planning/production-planning");
  return { ok: true };
}

export async function deleteProductionPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plans").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp("/planning/production-planning");
  return { ok: true };
}

export async function submitProductionPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_plans")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${id}`, "/planning/production-planning");
  return { ok: true };
}

export async function approveProductionPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_plans")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "production_plan.approved", entityType: "production_plan", entityId: id });
  revalidatePp(`/planning/production-planning/${id}`, "/planning/production-planning");
  return { ok: true };
}

// ============================================================================
// PRODUCTION PLANNING — Child Row CRUD: Orders
// ============================================================================

export async function addProductionPlanOrder(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_orders").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${data.production_plan_id}`);
  return { ok: true };
}

export async function updateProductionPlanOrder(
  id: string, planId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_orders").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${planId}`);
  return { ok: true };
}

export async function deleteProductionPlanOrder(
  id: string, planId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${planId}`);
  return { ok: true };
}

// ============================================================================
// PRODUCTION PLANNING — Child Row CRUD: Details
// ============================================================================

export async function addProductionPlanDetail(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_details").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${data.production_plan_id}`);
  return { ok: true };
}

export async function updateProductionPlanDetail(
  id: string, planId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_details").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${planId}`);
  return { ok: true };
}

export async function deleteProductionPlanDetail(
  id: string, planId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("production_plan_details").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePp(`/planning/production-planning/${planId}`);
  return { ok: true };
}
