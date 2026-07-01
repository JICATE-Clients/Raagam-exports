"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  vendorInput,
  rfqInput,
  rfqQuoteInput,
  purchaseOrderInput,
  poLineInput,
  lineAmount,
} from "@/lib/purchase/types";
import type {
  VendorInput,
  RfqInput,
  RfqQuoteInput,
  PurchaseOrderInput,
  PoLineInput,
} from "@/lib/purchase/types";
import { getBudgetLines } from "./po-service";
import type { BudgetLineRow } from "./po-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidatePurchase(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/purchase");
}

// ---------- recalc ----------

export async function recalcPoTotal(poId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from("po_line_items")
    .select("amount")
    .eq("purchase_order_id", poId);

  const total = ((lines ?? []) as { amount: number }[]).reduce(
    (sum, l) => sum + (l.amount ?? 0),
    0,
  );

  const { error } = await supabase
    .from("purchase_orders")
    .update({ total_amount: total })
    .eq("id", poId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- vendor actions ----------

export async function createVendor(data: VendorInput): Promise<ActionResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = vendorInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vendors").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase("/purchase/vendors");
  return { ok: true };
}

export async function updateVendor(
  id: string,
  data: VendorInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = vendorInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vendors")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase("/purchase/vendors");
  return { ok: true };
}

// ---------- RFQ actions ----------

export async function createRfq(
  data: RfqInput,
): Promise<{ ok: true; rfqId: string } | ErrResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = rfqInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...rfqFields } = parsed.data;

  const { data: rfq, error } = await supabase
    .from("rfqs")
    .insert({ ...rfqFields, status: "open", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !rfq) {
    return { ok: false, error: error?.message ?? "Failed to create RFQ" };
  }

  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("rfq_lines").insert(
      lines.map((l, i) => ({
        ...l,
        rfq_id: rfq.id,
        sort_order: l.sort_order ?? i,
      })),
    );
    if (lineErr) {
      console.error("[purchase/rfq] rfq_lines insert:", lineErr.message);
    }
  }

  revalidatePurchase("/purchase/rfq");
  return { ok: true, rfqId: rfq.id };
}

export async function addRfqQuote(data: RfqQuoteInput): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = rfqQuoteInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("rfq_quotes")
    .insert({ ...parsed.data, is_selected: false });
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/rfq/${data.rfq_id}`);
  return { ok: true };
}

export async function selectRfqQuote(
  quoteId: string,
  rfqId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // deselect all quotes for this RFQ, then select the chosen one
  const { error: resetErr } = await supabase
    .from("rfq_quotes")
    .update({ is_selected: false })
    .eq("rfq_id", rfqId);
  if (resetErr) return { ok: false, error: resetErr.message };

  const { error: selectErr } = await supabase
    .from("rfq_quotes")
    .update({ is_selected: true })
    .eq("id", quoteId);
  if (selectErr) return { ok: false, error: selectErr.message };

  const { error: rfqErr } = await supabase
    .from("rfqs")
    .update({ status: "awarded" })
    .eq("id", rfqId);
  if (rfqErr) return { ok: false, error: rfqErr.message };

  revalidatePurchase(`/purchase/rfq/${rfqId}`, "/purchase/rfq");
  return { ok: true };
}

// ---------- budget lines data action ----------

/** Read-only data action — fetches budget lines for the PO form prefill. */
export async function fetchBudgetLines(
  budgetId: string,
): Promise<BudgetLineRow[]> {
  return getBudgetLines(budgetId);
}

// ---------- PO actions ----------

export async function createPurchaseOrder(
  data: PurchaseOrderInput,
): Promise<{ ok: true; poId: string } | ErrResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = purchaseOrderInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...poFields } = parsed.data;

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      ...poFields,
      status: "draft",
      total_amount: 0,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !po) {
    return { ok: false, error: error?.message ?? "Failed to create PO" };
  }

  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("po_line_items").insert(
      lines.map((l, i) => ({
        ...l,
        purchase_order_id: po.id,
        amount: lineAmount(l.quantity, l.unit_price),
        received_qty: 0,
        sort_order: l.sort_order ?? i,
      })),
    );
    if (lineErr) return { ok: false, error: lineErr.message };
  }

  await recalcPoTotal(po.id);
  revalidatePurchase("/purchase/orders");
  return { ok: true, poId: po.id };
}

export async function addPoLine(
  poId: string,
  data: PoLineInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poLineInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { quantity, unit_price, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_price);

  const supabase = await createClient();
  const { error } = await supabase.from("po_line_items").insert({
    ...rest,
    purchase_order_id: poId,
    quantity,
    unit_price,
    amount,
    received_qty: 0,
  });
  if (error) return { ok: false, error: error.message };

  await recalcPoTotal(poId);
  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function updatePoLine(
  lineId: string,
  poId: string,
  data: PoLineInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poLineInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { quantity, unit_price, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_price);

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_line_items")
    .update({ ...rest, quantity, unit_price, amount })
    .eq("id", lineId);
  if (error) return { ok: false, error: error.message };

  await recalcPoTotal(poId);
  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function deletePoLine(
  lineId: string,
  poId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_line_items")
    .delete()
    .eq("id", lineId);
  if (error) return { ok: false, error: error.message };

  await recalcPoTotal(poId);
  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function submitPo(poId: string): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .maybeSingle();

  if (!po || (po as { status: string }).status !== "draft") {
    return { ok: false, error: "Purchase order is not in draft status" };
  }

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "pending_approval" })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`, "/purchase/orders");
  return { ok: true };
}

export async function approvePo(poId: string): Promise<ActionResult> {
  if (!(await can("materials_purchase", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("status, total_amount")
    .eq("id", poId)
    .maybeSingle();

  const poRow = po as { status: string; total_amount: number } | null;

  if (!poRow || poRow.status !== "pending_approval") {
    return { ok: false, error: "Purchase order is not pending approval" };
  }

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "purchase_order.approved",
    entityType: "purchase_order",
    entityId: poId,
    metadata: { total_amount: poRow.total_amount },
  });

  revalidatePurchase(`/purchase/orders/${poId}`, "/purchase/orders");
  return { ok: true };
}

export async function rejectPo(
  poId: string,
  note?: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("status, notes")
    .eq("id", poId)
    .maybeSingle();

  const poRow = po as { status: string; notes: string | null } | null;

  if (!poRow || poRow.status !== "pending_approval") {
    return { ok: false, error: "Purchase order is not pending approval" };
  }

  const updatedNotes = note
    ? [poRow.notes, `Rejected: ${note}`].filter(Boolean).join("\n")
    : poRow.notes;

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "draft", notes: updatedNotes })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "purchase_order.rejected",
    entityType: "purchase_order",
    entityId: poId,
    metadata: { note: note ?? null },
  });

  revalidatePurchase(`/purchase/orders/${poId}`, "/purchase/orders");
  return { ok: true };
}
