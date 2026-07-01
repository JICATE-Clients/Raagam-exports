"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  salesOrderInput,
  orderLineInput,
  amendmentInput,
  taPlanInput,
  type SalesOrderInput,
  type AmendmentInput,
  type TaPlanInput,
  type MilestoneStatus,
} from "./types";

type OrderLineData = z.infer<typeof orderLineInput>;

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateOrderResult = { ok: true; orderId: string } | ErrResult;

// ---------- date util ----------

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ---------- auto T&A stages (mirrors the seeded Standard Knit T&A template) ----------

const AUTO_STAGES = [
  { name: "Yarn Purchase", sequence: 1, offset_days: -75 },
  { name: "Knitting", sequence: 2, offset_days: -65 },
  { name: "Dyeing", sequence: 3, offset_days: -55 },
  { name: "Fabric In-house", sequence: 4, offset_days: -45 },
  { name: "Cutting", sequence: 5, offset_days: -35 },
  { name: "Sewing", sequence: 6, offset_days: -20 },
  { name: "Finishing & Packing", sequence: 7, offset_days: -7 },
  { name: "Ex-factory", sequence: 8, offset_days: 0 },
] as const;

// ---------- create order ----------

export async function createOrder(
  payload: SalesOrderInput & { baseline_fob?: number | null },
): Promise<CreateOrderResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = salesOrderInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { lines, ...orderFields } = parsed.data;
  const baseline_fob = payload.baseline_fob ?? orderFields.fob_price;
  const total_value = orderFields.order_qty * orderFields.fob_price;

  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("sales_orders")
    .insert({ ...orderFields, baseline_fob, total_value })
    .select("id")
    .single();

  if (error || !order) {
    return { ok: false, error: error?.message ?? "Failed to create order" };
  }

  // insert line items if provided
  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("so_line_items").insert(
      lines.map((l) => ({ ...l, sales_order_id: order.id })),
    );
    if (lineErr) {
      // order was created; log the line error but do not fail the whole operation
      console.error("so_line_items insert error:", lineErr.message);
    }
  }

  await writeAudit({
    action: "order.created",
    entityType: "sales_order",
    entityId: order.id,
  });

  revalidatePath("/");
  revalidatePath("/orders");

  return { ok: true, orderId: order.id };
}

// ---------- add line item ----------

export async function addOrderLine(
  orderId: string,
  data: OrderLineData,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = orderLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("so_line_items")
    .insert({ ...parsed.data, sales_order_id: orderId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

// ---------- generate T&A plan ----------

export async function generateTaPlan(
  data: TaPlanInput,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = taPlanInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // fetch the sales order for ship_date and created_at
  const { data: order, error: orderErr } = await supabase
    .from("sales_orders")
    .select("id, ship_date, created_at")
    .eq("id", parsed.data.sales_order_id)
    .single();

  if (orderErr || !order) {
    return { ok: false, error: "Order not found" };
  }

  // build milestone rows
  type MilestoneStage = {
    name: string;
    sequence: number;
    anchor: "order_date" | "ship_date";
    offset_days: number;
  };

  let stages: MilestoneStage[];

  if (parsed.data.method === "template") {
    if (!parsed.data.template_id) {
      return { ok: false, error: "Template ID required for template method" };
    }
    const { data: tmRows, error: tmErr } = await supabase
      .from("ta_template_milestones")
      .select("name, sequence, anchor, offset_days")
      .eq("template_id", parsed.data.template_id)
      .order("sequence");

    if (tmErr || !tmRows) {
      return { ok: false, error: "Failed to load template milestones" };
    }
    stages = tmRows as MilestoneStage[];
  } else {
    // auto: use hardcoded 8-stage schedule anchored to ship_date
    stages = AUTO_STAGES.map((s) => ({ ...s, anchor: "ship_date" as const }));
  }

  // resolve anchor dates
  const shipDateStr = order.ship_date as string | null;
  const orderDateStr = (order.created_at as string).split("T")[0];

  // check ship_date is present when any stage uses it
  const needsShipDate = stages.some((s) => s.anchor === "ship_date");
  if (needsShipDate && !shipDateStr) {
    return {
      ok: false,
      error: "Order has no ship date — set a ship date before generating the T&A plan.",
    };
  }

  // insert ta_plan
  const { data: plan, error: planErr } = await supabase
    .from("ta_plans")
    .insert({
      sales_order_id: parsed.data.sales_order_id,
      method: parsed.data.method,
      template_id: parsed.data.template_id ?? null,
    })
    .select("id")
    .single();

  if (planErr || !plan) {
    return { ok: false, error: planErr?.message ?? "Failed to create T&A plan" };
  }

  // compute planned_date per stage
  const milestones = stages.map((s) => {
    const anchor = s.anchor === "ship_date" ? shipDateStr! : orderDateStr;
    return {
      ta_plan_id: plan.id,
      sales_order_id: parsed.data.sales_order_id,
      name: s.name,
      sequence: s.sequence,
      planned_date: addDays(anchor, s.offset_days),
      status: "pending",
    };
  });

  const { error: milErr } = await supabase.from("ta_milestones").insert(milestones);
  if (milErr) {
    return { ok: false, error: milErr.message };
  }

  revalidatePath(`/orders/${parsed.data.sales_order_id}`);
  revalidatePath("/");

  return { ok: true };
}

// ---------- update milestone ----------

export async function updateMilestone(
  milestoneId: string,
  status: MilestoneStatus,
  actualDate?: string | null,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  // look up the sales_order_id for revalidation
  const { data: m } = await supabase
    .from("ta_milestones")
    .select("sales_order_id")
    .eq("id", milestoneId)
    .single();

  const { error } = await supabase
    .from("ta_milestones")
    .update({
      status,
      actual_date: actualDate ?? null,
    })
    .eq("id", milestoneId);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (m?.sales_order_id) {
    revalidatePath(`/orders/${m.sales_order_id}`);
    revalidatePath("/");
  }

  return { ok: true };
}

// ---------- raise amendment ----------

export async function raiseAmendment(
  data: AmendmentInput,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = amendmentInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("order_amendments").insert({
    ...parsed.data,
    status: "pending",
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/orders/${parsed.data.sales_order_id}`);
  revalidatePath("/");

  return { ok: true };
}

// ---------- approve amendment ----------

export async function approveAmendment(
  amendmentId: string,
): Promise<ActionResult> {
  if (!(await can("orders", "approve"))) {
    throw new Error("Forbidden");
  }

  const user = await getAppUser();
  const supabase = await createClient();

  // fetch amendment
  const { data: amendment, error: amErr } = await supabase
    .from("order_amendments")
    .select("*")
    .eq("id", amendmentId)
    .single();

  if (amErr || !amendment) {
    return { ok: false, error: "Amendment not found" };
  }
  if (amendment.status !== "pending") {
    return { ok: false, error: "Amendment is no longer pending" };
  }

  // fetch order for current version
  const { data: order, error: orderErr } = await supabase
    .from("sales_orders")
    .select("*")
    .eq("id", amendment.sales_order_id)
    .single();

  if (orderErr || !order) {
    return { ok: false, error: "Order not found" };
  }

  const decidedAt = new Date().toISOString();
  const newVersion = (order.current_version as number) + 1;

  // mark amendment approved
  const { error: updateAmendErr } = await supabase
    .from("order_amendments")
    .update({
      status: "approved",
      decided_by: user?.id ?? null,
      decided_at: decidedAt,
    })
    .eq("id", amendmentId);

  if (updateAmendErr) {
    return { ok: false, error: updateAmendErr.message };
  }

  // bump order version
  const { error: bumpErr } = await supabase
    .from("sales_orders")
    .update({ current_version: newVersion })
    .eq("id", order.id);

  if (bumpErr) {
    return { ok: false, error: bumpErr.message };
  }

  // insert revision snapshot
  const { error: revErr } = await supabase.from("order_revisions").insert({
    sales_order_id: order.id,
    version: newVersion,
    snapshot: { order, amendment },
    reason:
      amendment.description ??
      `Amendment: ${amendment.amendment_type} approved`,
    created_by: user?.id ?? null,
  });

  if (revErr) {
    // revision insert failing should not roll back the approval — log only
    console.error("order_revisions insert error:", revErr.message);
  }

  // TODO: cascade amendment effects to BOM, Purchase, etc. (out of scope for this pass)

  await writeAudit({
    action: "amendment.approved",
    entityType: "sales_order",
    entityId: order.id,
    metadata: { amendmentId, amendmentType: amendment.amendment_type },
  });

  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/");

  return { ok: true };
}

// ---------- reject amendment ----------

export async function rejectAmendment(
  amendmentId: string,
  decidedReason: string,
): Promise<ActionResult> {
  if (!(await can("orders", "approve"))) {
    throw new Error("Forbidden");
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: amendment, error: amErr } = await supabase
    .from("order_amendments")
    .select("sales_order_id, status, amendment_type")
    .eq("id", amendmentId)
    .single();

  if (amErr || !amendment) {
    return { ok: false, error: "Amendment not found" };
  }
  if (amendment.status !== "pending") {
    return { ok: false, error: "Amendment is no longer pending" };
  }

  const { error } = await supabase
    .from("order_amendments")
    .update({
      status: "rejected",
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
      decided_reason: decidedReason,
    })
    .eq("id", amendmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: "amendment.rejected",
    entityType: "sales_order",
    entityId: amendment.sales_order_id,
    metadata: { amendmentId, amendmentType: amendment.amendment_type, reason: decidedReason },
  });

  revalidatePath(`/orders/${amendment.sales_order_id}`);
  revalidatePath("/");

  return { ok: true };
}
