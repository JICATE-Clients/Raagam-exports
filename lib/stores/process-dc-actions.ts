"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getCurrentLocation } from "@/lib/auth/location";
import { capsTextNullable } from "@/lib/validation/formats";

/**
 * PROCESS DC ACTIONS (0786). A Process DC always goes out against a Process Order (user
 * 2026-10-31). The vendor and process are COPIED from the order — never taken from the
 * payload — and every line must be one of the order's lines. Dispatch is one database
 * function (`process_dc_dispatch`), which re-checks the order's balance and moves the stock.
 */

type Result = { ok: true; id: string } | { ok: false; error: string };

const lineInput = z.object({
  process_order_line_id: z.string().uuid(),
  item_id: z.string().uuid({ message: "A line has no item on the Process Order" }),
  description: z.string().nullable().optional(),
  sent_qty: z.coerce.number().positive({ message: "Every line needs a qty" }),
  from_store_id: z.string().uuid({ message: "Pick a store on every line" }),
  bin_id: z.string().uuid().nullable().optional(),
  lot_no: capsTextNullable(),
});

const dcInput = z.object({
  process_order_id: z.string().uuid({ message: "Pick the Process Order" }),
  dc_date: z.string().min(1, "Pick the DC date"),
  expected_return_date: z.string().nullable().optional(),
  vehicle_no: capsTextNullable(),
  transporter: capsTextNullable(),
  eway_bill_no: capsTextNullable(),
  lines: z.array(lineInput).min(1, "Enter a qty on at least one line"),
});
export type ProcessDcInput = z.input<typeof dcInput>;

function friendly(message: string): string {
  if (/Insufficient stock/i.test(message)) return "Not enough stock in the store for one of the lines — check the qty";
  return message;
}

export async function saveProcessDc(id: string | null, payload: ProcessDcInput, dispatch: boolean): Promise<Result> {
  if (!(await can("stores", id ? "edit" : "create"))) return { ok: false, error: "You do not have permission to raise a Process DC" };
  const parsed = dcInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { lines, ...header } = parsed.data;
  const { location } = await getCurrentLocation();
  if (!location) return { ok: false, error: "Pick your working unit in the top bar first" };

  const supabase = await createClient();
  const { data: order, error: oErr } = await supabase
    .from("process_orders")
    .select("id, vendor_id, process_type, status")
    .eq("id", header.process_order_id)
    .maybeSingle();
  if (oErr) return { ok: false, error: oErr.message };
  const o = order as { id: string; vendor_id: string; process_type: string; status: string } | null;
  if (!o) return { ok: false, error: "That Process Order is not in this unit" };
  if (!["issued", "in_process", "partially_received"].includes(o.status)) {
    return { ok: false, error: "Issue the Process Order before sending goods against it" };
  }
  const { data: ol } = await supabase.from("process_order_lines").select("id").eq("process_order_id", o.id);
  const own = new Set(((ol ?? []) as { id: string }[]).map((x) => x.id));
  if (lines.some((l) => !own.has(l.process_order_line_id))) return { ok: false, error: "A line is not on that Process Order" };

  const row = {
    ...header,
    expected_return_date: header.expected_return_date || null,
    vendor_id: o.vendor_id,
    process_type: o.process_type,
  };
  let dcId = id;
  if (dcId) {
    const { error } = await supabase.from("delivery_challans").update(row).eq("id", dcId).eq("status", "draft");
    if (error) return { ok: false, error: error.message };
    const { error: delErr } = await supabase.from("dc_line_items").delete().eq("delivery_challan_id", dcId);
    if (delErr) return { ok: false, error: delErr.message };
  } else {
    const { data, error } = await supabase
      .from("delivery_challans")
      .insert({ ...row, dc_kind: "process", location_id: location.id, status: "draft", purpose: `Job work — ${o.process_type}` })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save the DC" };
    dcId = (data as { id: string }).id;
  }
  const { error: lineErr } = await supabase
    .from("dc_line_items")
    .insert(lines.map((l, i) => ({ ...l, delivery_challan_id: dcId, sort_order: i, returned_qty: 0 })));
  if (lineErr) {
    if (!id) await supabase.from("delivery_challans").delete().eq("id", dcId);
    return { ok: false, error: lineErr.message };
  }

  if (dispatch) {
    const { error } = await supabase.rpc("process_dc_dispatch", { p_dc_id: dcId });
    if (error) {
      revalidatePath("/purchase/dc");
      return { ok: false, error: `Saved as a draft, not dispatched: ${friendly(error.message)}` };
    }
    await writeAudit({ action: "process_dc.dispatched", entityType: "delivery_challan", entityId: dcId! });
    revalidatePath("/stores/process-orders");
  } else {
    await writeAudit({ action: id ? "process_dc.updated" : "process_dc.created", entityType: "delivery_challan", entityId: dcId! });
  }
  revalidatePath("/purchase/dc");
  return { ok: true, id: dcId! };
}

export async function deleteProcessDc(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to delete a Process DC" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_challans")
    .delete()
    .eq("id", id)
    .eq("dc_kind", "process")
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a draft can be deleted" };
  await writeAudit({ action: "process_dc.deleted", entityType: "delivery_challan", entityId: id });
  revalidatePath("/purchase/dc");
  return { ok: true };
}

const receiptLine = z.object({
  dc_line_id: z.string().uuid(),
  output_item_id: z.string().uuid().nullable().optional(),
  received_qty: z.coerce.number().nonnegative(),
  input_used_qty: z.coerce.number().nonnegative(),
  close_balance: z.boolean().default(false),
  store_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  lot_no: z.string().nullable().optional(),
});
const receiptInput = z.object({
  receipt_date: z.string().min(1, "Pick the receipt date"),
  vendor_dc_no: capsTextNullable(),
  lines: z.array(receiptLine).min(1, "Enter what came back on at least one line"),
});
export type ProcessReceiptInput = z.input<typeof receiptInput>;

/**
 * PROCESS RECEIPT (0787): what came back from the processor, in one database function —
 * input used leaves the Processing store, the output (possibly a different item) enters the
 * chosen store, loss is measured against the order's Allowed Loss %, and a draft bill is
 * raised at the order rate with any excess loss flagged on it (never blocked).
 */
export async function receiveProcessDc(dcId: string, payload: ProcessReceiptInput): Promise<Result> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to receive job work" };
  const parsed = receiptInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { lines, ...header } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("process_receipt_post", {
    p_dc_id: dcId,
    p_lines: lines,
    p_header: header,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  await writeAudit({ action: "process_receipt.posted", entityType: "dc_receipt", entityId: String(data) });
  revalidatePath("/purchase/dc");
  revalidatePath("/stores/process-orders");
  revalidatePath("/finance/payables");
  return { ok: true, id: String(data) };
}
