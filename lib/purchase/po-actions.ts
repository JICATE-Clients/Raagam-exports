"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  vendorInput,
  rfqInput,
  rfqQuoteInput,
  rfqQuoteLineInput,
  purchaseOrderInput,
  poLineInput,
  poItemGroupInput,
  poSizeDeliveryInput,
  poDeliverySizeInput,
  poItemSizeDeliveryInput,
  poAdditionalChargeInput,
  lineAmount,
} from "@/lib/purchase/types";
import type {
  VendorInput,
  RfqInput,
  RfqQuoteInput,
  RfqQuoteLineInput,
  PurchaseOrderInput,
  PoLineInput,
  PoItemGroupInput,
  PoSizeDeliveryInput,
  PoDeliverySizeInput,
  PoItemSizeDeliveryInput,
  PoAdditionalChargeInput,
} from "@/lib/purchase/types";
import {
  getBudgetLines,
  getPoSizeDeliveries,
  getPoDeliverySizes,
  getPoItemSizeDeliveries,
} from "./po-service";
import type { BudgetLineRow } from "./po-service";
import type {
  PoSizeDelivery,
  PoDeliverySize,
  PoItemSizeDelivery,
} from "@/lib/purchase/types";

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

// ---------- RFQ quote lines ----------

export async function saveRfqQuoteLines(
  quoteId: string,
  rfqId: string,
  lines: RfqQuoteLineInput[],
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // delete existing then re-insert
  const { error: delErr } = await supabase
    .from("rfq_quote_lines")
    .delete()
    .eq("rfq_quote_id", quoteId);
  if (delErr) return { ok: false, error: delErr.message };

  if (lines.length > 0) {
    const valid = lines
      .map((l) => {
        const r = rfqQuoteLineInput.safeParse({
          ...l,
          rfq_quote_id: quoteId,
        });
        return r.success ? r.data : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (valid.length > 0) {
      const { error: insErr } = await supabase
        .from("rfq_quote_lines")
        .insert(valid);
      if (insErr) return { ok: false, error: insErr.message };
    }

    // recalc quote total
    const total = valid.reduce((sum, l) => sum + (l.amount ?? 0), 0);
    await supabase
      .from("rfq_quotes")
      .update({ total_amount: total })
      .eq("id", quoteId);
  }

  revalidatePurchase(`/purchase/rfq/${rfqId}`);
  return { ok: true };
}

// ---------- read-only data actions ----------

/** Read-only data action — fetches budget lines for the PO form prefill. */
export async function fetchBudgetLines(
  budgetId: string,
): Promise<BudgetLineRow[]> {
  return getBudgetLines(budgetId);
}

/**
 * Bands 2-4 of the PO detail load their rows on demand, when the operator
 * expands a line — the ids are only known at click time, so the server parent
 * cannot pass them down as props.
 *
 * They must therefore cross the client boundary as ACTIONS. `po-delivery-editor`
 * imported the `po-service` getters directly instead, which cannot work: the
 * service is `server-only` and reaches for `next/headers`, so the bundler
 * refused the whole route ("You're importing a module that depends on
 * server-only"). The build has been failing on it.
 *
 * Thin passthroughs, matching `fetchBudgetLines` above — the query stays in
 * `po-service`, and RLS remains the gate on a read, as it is there.
 */
export async function fetchPoSizeDeliveries(
  lineItemId: string,
): Promise<PoSizeDelivery[]> {
  return getPoSizeDeliveries(lineItemId);
}

export async function fetchPoDeliverySizes(
  sizeDeliveryId: string,
): Promise<PoDeliverySize[]> {
  return getPoDeliverySizes(sizeDeliveryId);
}

export async function fetchPoItemSizeDeliveries(
  lineItemId: string,
): Promise<PoItemSizeDelivery[]> {
  return getPoItemSizeDeliveries(lineItemId);
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

// ---------- PO item groups (Band 0) ----------

export async function addPoItemGroup(
  data: PoItemGroupInput,
): Promise<{ ok: true; groupId: string } | ErrResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poItemGroupInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("po_item_groups")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? "Failed" };

  revalidatePurchase(`/purchase/orders/${data.purchase_order_id}`);
  return { ok: true, groupId: row.id };
}

export async function deletePoItemGroup(
  groupId: string,
  poId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_item_groups")
    .delete()
    .eq("id", groupId);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO size deliveries (Band 2) ----------

export async function addPoSizeDelivery(
  poId: string,
  data: PoSizeDeliveryInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poSizeDeliveryInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_size_deliveries")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function deletePoSizeDelivery(
  id: string,
  poId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_size_deliveries")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO delivery sizes (Band 3) ----------

export async function addPoDeliverySize(
  poId: string,
  data: PoDeliverySizeInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poDeliverySizeInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_delivery_sizes")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function deletePoDeliverySize(
  id: string,
  poId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_delivery_sizes")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO item size deliveries (Band 4) ----------

export async function addPoItemSizeDelivery(
  poId: string,
  data: PoItemSizeDeliveryInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = poItemSizeDeliveryInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_item_size_deliveries")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

export async function deletePoItemSizeDelivery(
  id: string,
  poId: string,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_item_size_deliveries")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO additional charges ----------

export async function savePoCharges(
  poId: string,
  charges: PoAdditionalChargeInput[],
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // delete existing then re-insert
  const { error: delErr } = await supabase
    .from("po_additional_charges")
    .delete()
    .eq("purchase_order_id", poId);
  if (delErr) return { ok: false, error: delErr.message };

  if (charges.length > 0) {
    const valid = charges
      .map((c, i) => {
        const r = poAdditionalChargeInput.safeParse({
          ...c,
          purchase_order_id: poId,
          sort_order: c.sort_order ?? i,
        });
        return r.success ? r.data : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (valid.length > 0) {
      const { error: insErr } = await supabase
        .from("po_additional_charges")
        .insert(valid);
      if (insErr) return { ok: false, error: insErr.message };
    }
  }

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO commercial update ----------

export async function updatePoCommercial(
  poId: string,
  fields: Partial<PurchaseOrderInput>,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update(fields)
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}

// ---------- PO general/logistics update ----------

export async function updatePoGeneral(
  poId: string,
  fields: {
    quality_requirements?: string | null;
    bank_guarantee?: string | null;
    warranty_terms?: string | null;
    delivery_instructions?: string | null;
    insurance_details?: string | null;
    port_of_shipment?: string | null;
    transport_name?: string | null;
    transport_details?: string | null;
  },
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update(fields)
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePurchase(`/purchase/orders/${poId}`);
  return { ok: true };
}
