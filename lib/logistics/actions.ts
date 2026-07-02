"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  shipmentInput,
  shipmentLineInput,
  lineAmount,
  REQUIRED_DOC_TYPES,
  type ShipmentInput,
  type ShipmentLineInput,
  type DocType,
} from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; shipmentId: string } | ErrResult;

// ---------- createShipment ----------

export async function createShipment(
  payload: ShipmentInput,
): Promise<CreateResult> {
  if (!(await can("logistics", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = shipmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await getAppUser();
  const supabase = await createClient();
  const { sales_order_ids, ...shipmentFields } = parsed.data;

  const { data: shipment, error } = await supabase
    .from("shipments")
    .insert({ ...shipmentFields, created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !shipment) {
    return { ok: false, error: error?.message ?? "Failed to create shipment" };
  }

  // insert shipment_orders junction rows
  if (sales_order_ids.length > 0) {
    const { error: junctionErr } = await supabase.from("shipment_orders").insert(
      sales_order_ids.map((soId) => ({
        shipment_id: shipment.id,
        sales_order_id: soId,
      })),
    );
    if (junctionErr) {
      console.error("shipment_orders insert error:", junctionErr.message);
    }
  }

  revalidatePath("/logistics");
  return { ok: true, shipmentId: shipment.id };
}

// ---------- updateShipment ----------

export async function updateShipment(
  shipmentId: string,
  payload: Omit<Partial<ShipmentInput>, "sales_order_ids">,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipments")
    .update(payload)
    .eq("id", shipmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/logistics/${shipmentId}`);
  revalidatePath("/logistics");
  return { ok: true };
}

// ---------- recomputeTotal (internal) ----------

async function recomputeTotal(shipmentId: string): Promise<void> {
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from("shipment_lines")
    .select("amount")
    .eq("shipment_id", shipmentId);
  const total = (lines ?? []).reduce((s, l) => s + ((l.amount as number) ?? 0), 0);
  await supabase
    .from("shipments")
    .update({ total_value: total })
    .eq("id", shipmentId);
}

// ---------- addLine ----------

export async function addLine(
  shipmentId: string,
  data: ShipmentLineInput,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = shipmentLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { quantity, unit_price, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_price);

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_lines")
    .insert({ ...rest, quantity, unit_price, amount, shipment_id: shipmentId });

  if (error) {
    return { ok: false, error: error.message };
  }

  await recomputeTotal(shipmentId);
  revalidatePath(`/logistics/${shipmentId}`);
  return { ok: true };
}

// ---------- updateLine ----------

export async function updateLine(
  lineId: string,
  shipmentId: string,
  data: ShipmentLineInput,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = shipmentLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { quantity, unit_price, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_price);

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_lines")
    .update({ ...rest, quantity, unit_price, amount })
    .eq("id", lineId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await recomputeTotal(shipmentId);
  revalidatePath(`/logistics/${shipmentId}`);
  return { ok: true };
}

// ---------- deleteLine ----------

export async function deleteLine(
  lineId: string,
  shipmentId: string,
): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipment_lines")
    .delete()
    .eq("id", lineId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await recomputeTotal(shipmentId);
  revalidatePath(`/logistics/${shipmentId}`);
  return { ok: true };
}

// ---------- pullLinesFromOrders ----------

export async function pullLinesFromOrders(
  shipmentId: string,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  const { data: shipmentOrders } = await supabase
    .from("shipment_orders")
    .select("sales_order_id")
    .eq("shipment_id", shipmentId);

  const orderIds = (shipmentOrders ?? []).map((r) => r.sales_order_id as string);

  if (orderIds.length === 0) {
    return { ok: false, error: "No orders linked to this shipment" };
  }

  const { data: rawLines } = await supabase
    .from("so_line_items")
    .select(
      "sales_order_id, color, size, quantity, sales_orders!inner(order_number, fob_price)",
    )
    .in("sales_order_id", orderIds);

  if (!rawLines || rawLines.length === 0) {
    return { ok: false, error: "No line items found on linked orders" };
  }

  // append after the current last sort_order
  const { data: existingLines } = await supabase
    .from("shipment_lines")
    .select("sort_order")
    .eq("shipment_id", shipmentId)
    .order("sort_order", { ascending: false })
    .limit(1);

  let sortOrder = (existingLines?.[0]?.sort_order ?? -1) + 1;

  type RawLine = {
    sales_order_id: string;
    color: string | null;
    size: string | null;
    quantity: number;
    sales_orders: { order_number: string | null; fob_price: number } | null;
  };

  const toInsert = (rawLines as unknown as RawLine[]).map((r) => {
    const so = r.sales_orders;
    const unitPrice = so?.fob_price ?? 0;
    const qty = r.quantity;
    const description = [so?.order_number ?? r.sales_order_id.slice(0, 8), r.color, r.size]
      .filter(Boolean)
      .join(" / ");

    return {
      shipment_id: shipmentId,
      sales_order_id: r.sales_order_id,
      description,
      quantity: qty,
      unit_price: unitPrice,
      amount: lineAmount(qty, unitPrice),
      sort_order: sortOrder++,
    };
  });

  const { error } = await supabase.from("shipment_lines").insert(toInsert);

  if (error) {
    return { ok: false, error: error.message };
  }

  await recomputeTotal(shipmentId);
  revalidatePath(`/logistics/${shipmentId}`);
  return { ok: true };
}

// ---------- _generateDoc (internal) ----------

type BuyerSnapshot = {
  id: string;
  name: string | null;
  code: string | null;
  address: string | null;
} | null;

async function _generateDoc(
  shipmentId: string,
  docType: DocType,
): Promise<ActionResult> {
  const supabase = await createClient();

  const [{ data: shipment }, { data: lines }, { data: buyerJoin }] =
    await Promise.all([
      supabase.from("shipments").select("*").eq("id", shipmentId).single(),
      supabase
        .from("shipment_lines")
        .select("*")
        .eq("shipment_id", shipmentId)
        .order("sort_order"),
      supabase
        .from("shipments")
        .select("buyers(id, name, code, address)")
        .eq("id", shipmentId)
        .single(),
    ]);

  if (!shipment) {
    return { ok: false, error: "Shipment not found" };
  }

  // deterministic doc_no: SHP-XXXX/CI etc.
  const code = (shipment.code as string | null) ?? shipmentId.slice(0, 8);
  const suffixes: Record<DocType, string> = {
    commercial_invoice: "CI",
    packing_list: "PL",
    bill_of_lading: "BL",
    gst_invoice: "GST",
    dgft: "DGFT",
    certificate_of_origin: "COO",
    gsp: "GSP",
    single_country_declaration: "SCD",
    ep_copy_receipt: "EP",
    boe: "BOE",
    tt_advice: "TT",
  };
  const docNo =
    docType === "gst_invoice" && (shipment.invoice_no as string | null)
      ? (shipment.invoice_no as string)
      : `${code}/${suffixes[docType]}`;

  const buyer = (
    (buyerJoin as unknown as { buyers: BuyerSnapshot } | null)?.buyers ?? null
  );

  const snapshot: Record<string, unknown> = {
    shipment,
    lines: lines ?? [],
    buyer,
    generated_at: new Date().toISOString(),
  };

  const user = await getAppUser();

  const { error } = await supabase.from("shipment_documents").upsert(
    {
      shipment_id: shipmentId,
      doc_type: docType,
      doc_no: docNo,
      status: "generated",
      data: snapshot,
      generated_at: new Date().toISOString(),
      created_by: user?.id ?? null,
    },
    { onConflict: "shipment_id,doc_type" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// ---------- generateDocument (single) ----------

export async function generateDocument(
  shipmentId: string,
  docType: DocType,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }
  return _generateDoc(shipmentId, docType);
}

// ---------- generateAllDocuments ----------

export async function generateAllDocuments(
  shipmentId: string,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data: shipment } = await supabase
    .from("shipments")
    .select("status")
    .eq("id", shipmentId)
    .single();

  for (const docType of REQUIRED_DOC_TYPES) {
    const result = await _generateDoc(shipmentId, docType);
    if (!result.ok) {
      return result;
    }
  }

  // advance status from 'planning' → 'docs_ready'
  if ((shipment?.status as string | null) === "planning") {
    await supabase
      .from("shipments")
      .update({ status: "docs_ready" })
      .eq("id", shipmentId);
  }

  await writeAudit({
    action: "logistics.documents_generated",
    entityType: "shipment",
    entityId: shipmentId,
  });

  revalidatePath(`/logistics/${shipmentId}`);
  revalidatePath("/logistics");
  return { ok: true };
}

// ---------- markShipped ----------

export async function markShipped(shipmentId: string): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data: shipment } = await supabase
    .from("shipments")
    .select("status, buyer_id, currency_code, total_value, invoice_no, invoice_date")
    .eq("id", shipmentId)
    .single();

  if ((shipment?.status as string | null) !== "docs_ready") {
    return {
      ok: false,
      error: "Shipment must be in 'Docs Ready' status to mark as shipped",
    };
  }

  const { error } = await supabase
    .from("shipments")
    .update({ status: "shipped" })
    .eq("id", shipmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: "logistics.shipment_shipped",
    entityType: "shipment",
    entityId: shipmentId,
  });

  // Shipment completion → draft Finance receivable (AR). Admin client because the
  // logistics user does not hold finance permissions. Best-effort; skip if a
  // receivable already exists for this shipment. The AR team sets the real forex
  // rate afterward (defaults to 1:1 here).
  try {
    const s = shipment as {
      buyer_id: string | null;
      currency_code: string | null;
      total_value: number | null;
      invoice_no: string | null;
      invoice_date: string | null;
    };
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("receivables")
      .select("id")
      .eq("shipment_id", shipmentId)
      .limit(1)
      .maybeSingle();
    if (!existing) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const amount = s.total_value ?? 0;
      await admin.from("receivables").insert({
        buyer_id: s.buyer_id,
        shipment_id: shipmentId,
        invoice_no: s.invoice_no,
        invoice_date: s.invoice_date,
        currency_code: s.currency_code,
        amount_fc: amount,
        exchange_rate: 1,
        amount_inr: amount,
        status: "open",
        created_by: user?.id ?? null,
      });
      revalidatePath("/finance/receivables");
    }
  } catch {
    // best-effort AR creation
  }

  revalidatePath(`/logistics/${shipmentId}`);
  revalidatePath("/logistics");
  return { ok: true };
}

// ---------- markDelivered ----------

export async function markDelivered(shipmentId: string): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data: shipment } = await supabase
    .from("shipments")
    .select("status")
    .eq("id", shipmentId)
    .single();

  if ((shipment?.status as string | null) !== "shipped") {
    return { ok: false, error: "Shipment must be 'Shipped' to mark as delivered" };
  }

  const { error } = await supabase
    .from("shipments")
    .update({ status: "delivered" })
    .eq("id", shipmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/logistics/${shipmentId}`);
  revalidatePath("/logistics");
  return { ok: true };
}

// ---------- closeShipment ----------

export async function closeShipment(shipmentId: string): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shipments")
    .update({ status: "closed" })
    .eq("id", shipmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/logistics/${shipmentId}`);
  revalidatePath("/logistics");
  return { ok: true };
}
