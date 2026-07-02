"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { shipmentPlanInput, shipmentPlanOrderInput } from "./types";
import type { ShipmentPlanInput, ShipmentPlanOrderInput } from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; planId: string } | ErrResult;

function revalidatePlan(planId?: string): void {
  if (planId) revalidatePath(`/planning/shipment-plans/${planId}`);
  revalidatePath("/planning/shipment-plans");
  revalidatePath("/planning");
}

// ---------- create ----------

export async function createShipmentPlan(
  payload: ShipmentPlanInput,
): Promise<CreateResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = shipmentPlanInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shipment_plans")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create shipment plan" };
  }

  revalidatePlan(data.id);
  return { ok: true, planId: data.id };
}

// ---------- add / update an order line ----------

export async function upsertPlanOrder(
  planId: string,
  data: ShipmentPlanOrderInput,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = shipmentPlanOrderInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_plan_orders")
    .upsert(
      { shipment_plan_id: planId, ...parsed.data },
      { onConflict: "shipment_plan_id,sales_order_id" },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePlan(planId);
  return { ok: true };
}

// ---------- remove an order line ----------

export async function removePlanOrder(
  planId: string,
  salesOrderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_plan_orders")
    .delete()
    .eq("shipment_plan_id", planId)
    .eq("sales_order_id", salesOrderId);

  if (error) return { ok: false, error: error.message };
  revalidatePlan(planId);
  return { ok: true };
}

// ---------- confirm ----------

export async function confirmShipmentPlan(planId: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { count } = await supabase
    .from("shipment_plan_orders")
    .select("sales_order_id", { count: "exact", head: true })
    .eq("shipment_plan_id", planId);

  if (!count || count < 1) {
    return { ok: false, error: "Add at least one order before confirming" };
  }

  const { data: plan } = await supabase
    .from("shipment_plans")
    .select("status")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || plan.status !== "draft") {
    return { ok: false, error: "Plan is not in draft status" };
  }

  const { error } = await supabase
    .from("shipment_plans")
    .update({ status: "confirmed" })
    .eq("id", planId);

  if (error) return { ok: false, error: error.message };
  revalidatePlan(planId);
  return { ok: true };
}

// ---------- cancel ----------

export async function cancelShipmentPlan(planId: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_plans")
    .update({ status: "cancelled" })
    .eq("id", planId);

  if (error) return { ok: false, error: error.message };
  revalidatePlan(planId);
  return { ok: true };
}

// ---------- delete (draft/cancelled only) ----------

export async function deleteShipmentPlan(planId: string): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("shipment_plans")
    .select("status")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !["draft", "cancelled"].includes(plan.status)) {
    return { ok: false, error: "Only draft or cancelled plans can be deleted" };
  }

  const { error } = await supabase.from("shipment_plans").delete().eq("id", planId);
  if (error) return { ok: false, error: error.message };
  revalidatePlan();
  return { ok: true };
}
