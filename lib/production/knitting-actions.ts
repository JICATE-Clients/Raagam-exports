"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { refuseReopenedBudget } from "@/lib/purchase/bom-ceiling-service";
import { getKnitCandidates, getKnittingOrder } from "./knitting-service";
import { saveProcessDc } from "@/lib/stores/process-dc-actions";
import type { KnitCandidatesResult, KnitReceiptInput, KnitSendLine, KnittingOrderInput } from "./knitting-types";

/**
 * KNITTING HUB writes (DB 0825). The save is ONE call to `knitting_order_save`, which writes
 * the process order, its fabrics, yarns and order lines in one transaction and computes every
 * derived figure itself — required kg, bags, the DC cap — from the inputs alone.
 */

type Fail = { ok: false; error: string };
const BASE = "/process/knitting-hub";

function revalidateKnitting(id?: string) {
  revalidatePath(BASE);
  if (id) revalidatePath(`${BASE}/${id}`);
  // A knitting order is a process order: Stores' lists show it too.
  revalidatePath("/stores/process-orders");
  revalidatePath("/stores/process-dc");
}

export async function loadKnitCandidates(salesOrderId: string, excludeOrderId: string | null): Promise<KnitCandidatesResult> {
  if (!(await can("stores", "view"))) return { ok: false, error: "Forbidden" };
  if (!salesOrderId) return { ok: false, error: "Pick the RE No first" };
  try {
    return await getKnitCandidates(salesOrderId, excludeOrderId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveKnittingOrder(id: string | null, input: KnittingOrderInput): Promise<{ ok: true; id: string } | Fail> {
  if (!(await can("stores", id ? "edit" : "create"))) return { ok: false, error: "Forbidden" };

  /* THE AMENDMENT HARD LOCK (doc/order/amedment.md §5) — the same gate a process order
     and a purchase order answer to: no knitting programme for an order whose revised budget
     is not yet approved. */
  // Every RE on the order (0836), each answering to its own budget.
  const res = [...new Set([input.sales_order_id, ...input.fabrics.map((f) => f.sales_order_id)].filter((x): x is string => !!x))];
  const reopened = await refuseReopenedBudget(res.map((sales_order_id) => ({ sales_order_id })));
  if (reopened) return { ok: false, error: reopened };

  // Knit Dia is asked for on every fabric (client 2026-11-11) — the screen holds the cursor on it.
  const noDia = input.fabrics.find((f) => !f.knit_dia?.trim());
  if (noDia) return { ok: false, error: `Type the Knit Dia for every fabric${noDia.finished_dia ? ` (Fin Dia ${noDia.finished_dia})` : ""}` };

  const s = await createClient();
  const { data, error } = await s.rpc("knitting_order_save", { p_order_id: id, p: input });
  if (error) return { ok: false, error: error.message };
  const savedId = data as string;
  await writeAudit({
    action: id ? "knitting_order.updated" : "knitting_order.created",
    entityType: "process_order",
    entityId: savedId,
  });
  revalidateKnitting(savedId);
  return { ok: true, id: savedId };
}

/** Issue = the order goes to the knitter; it is then read-only and Process DC can send yarn. */
export async function issueKnittingOrder(id: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data: po, error: poErr } = await s
    .from("process_orders")
    .select("sales_order_id, process_type, status, fabrics:process_order_knit_fabrics(id, sales_order_id)")
    .eq("id", id)
    .maybeSingle();
  if (poErr) return { ok: false, error: `Could not read the knitting order: ${poErr.message}` };
  const row = po as { sales_order_id: string | null; process_type: string; status: string; fabrics: { id: string; sales_order_id: string | null }[] | null } | null;
  if (!row || row.process_type !== "knitting") return { ok: false, error: "Knitting order not found" };
  if (row.status !== "draft") return { ok: false, error: "Only a draft knitting order can be issued" };
  if (!row.fabrics?.length) return { ok: false, error: "Add a fabric and save before issuing" };
  const res = [...new Set([row.sales_order_id, ...row.fabrics.map((f) => f.sales_order_id)].filter((x): x is string => !!x))];
  const reopened = await refuseReopenedBudget(res.map((sales_order_id) => ({ sales_order_id })));
  if (reopened) return { ok: false, error: reopened };

  const { error } = await s.from("process_orders").update({ status: "issued" }).eq("id", id).eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_order.issued", entityType: "process_order", entityId: id });
  revalidateKnitting(id);
  return { ok: true };
}

/** Cancel — only while no yarn has gone out (a draft, or an issued order with no DC sent). */
export async function cancelKnittingOrder(id: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  // Any DC carrying this order's lines — including one raised from another Knitting Order (0832).
  const { data: pol } = await s.from("process_order_lines").select("id").eq("process_order_id", id);
  const polIds = ((pol ?? []) as { id: string }[]).map((x) => x.id);
  const { data: dcs, error: dcErr } = polIds.length
    ? await s
        .from("dc_line_items")
        .select("id, dc:delivery_challans!inner(status)")
        .in("process_order_line_id", polIds)
        .neq("dc.status", "cancelled")
        .limit(1)
    : { data: [], error: null };
  if (dcErr) return { ok: false, error: `Could not check the yarn DCs: ${dcErr.message}` };
  if (dcs?.length) return { ok: false, error: "A yarn DC is raised against this order — cancel that DC first" };
  const { error } = await s
    .from("process_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("process_type", "knitting")
    .in("status", ["draft", "issued"]);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_order.cancelled", entityType: "process_order", entityId: id });
  revalidateKnitting(id);
  return { ok: true };
}

/**
 * DELETE (user 2026-11-12, screenshot 4121: "add delete option"). Only an order nothing has
 * happened to yet — a draft, an issued order with no yarn DC, or a cancelled one — and only with
 * `stores:delete`. Anything a DC, receipt, bill or GRN points at is refused, by the check below
 * for the common case and by the foreign keys (no action) for the rest; the fabric and yarn lines
 * go with the order (on delete cascade). RLS on process_orders turns a refused delete into 0 rows
 * SILENTLY, so the deleted row is asked back and its absence is an error.
 */
export async function deleteKnittingOrder(id: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "delete"))) return { ok: false, error: "You do not have permission to delete a knitting order" };
  const s = await createClient();
  const { data: po, error: poErr } = await s.from("process_orders").select("code, status, process_type").eq("id", id).maybeSingle();
  if (poErr) return { ok: false, error: `Could not read the knitting order: ${poErr.message}` };
  const row = po as { code: string | null; status: string; process_type: string } | null;
  if (!row || row.process_type !== "knitting") return { ok: false, error: "Knitting order not found" };
  if (!["draft", "issued", "cancelled"].includes(row.status)) {
    return { ok: false, error: `${row.code ?? "This order"} has yarn at the knitter — it cannot be deleted` };
  }
  const { data: pol } = await s.from("process_order_lines").select("id").eq("process_order_id", id);
  const polIds = ((pol ?? []) as { id: string }[]).map((x) => x.id);
  if (polIds.length) {
    const { data: dcs, error: dcErr } = await s.from("dc_line_items").select("id").in("process_order_line_id", polIds).limit(1);
    if (dcErr) return { ok: false, error: `Could not check the yarn DCs: ${dcErr.message}` };
    if (dcs?.length) return { ok: false, error: "A yarn DC was raised against this order (even a cancelled one keeps it) — cancel the order instead" };
  }
  const { data: gone, error } = await s.from("process_orders").delete().eq("id", id).eq("process_type", "knitting").select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Other documents point at this order (a DC, receipt or bill) — cancel it instead" };
    return { ok: false, error: error.message };
  }
  if (!gone?.length) return { ok: false, error: "The order was not deleted — it is not in your working unit, or you lack the delete permission" };
  await writeAudit({ action: "knitting_order.deleted", entityType: "process_order", entityId: id, metadata: { code: row.code } });
  revalidateKnitting(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 3 (0830) — fabric receipt, yarn return, close
// ---------------------------------------------------------------------------

/**
 * One knitter delivery, in one database call (`knitting_receipt_post`): the fabric in, each
 * yarn's share (fabric kg × blend %) used up at the knitter lot by lot, returned yarn back on
 * the shelf, and the draft bill at fabric kg × rate (D3).
 */
export async function receiveKnitting(orderId: string, input: KnitReceiptInput): Promise<{ ok: true; id: string } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to receive knitted fabric" };
  const fabrics = input.fabrics.filter((f) => f.net_kg > 0);
  const returns = input.returns.filter((r) => r.kg > 0);
  const party = (input.party ?? []).filter((p) => p.kg > 0);
  if (!fabrics.length && !returns.length && !party.length) return { ok: false, error: "Enter the fabric received, or the yarn returned" };
  if (!input.header.receipt_date) return { ok: false, error: "Pick the receipt date" };
  // The knitter's DC is the paper the fabric came on (client 2026-11-12, 0837 refuses it too).
  if (fabrics.length && (!input.header.vendor_dc_no?.trim() || !input.header.vendor_dc_date))
    return { ok: false, error: "Enter the Knitter DC No and Knitter DC Date the fabric came with" };
  if (party.some((p) => !p.to_order_id)) return { ok: false, error: "Pick the Knitting Order each Party Stock line goes to" };
  const s = await createClient();

  /* PARTY STOCK (0837): a return with any line going straight to another knitter posts in ONE
     call — the store lines through knitting_receipt_post, each party line as an at-knitter move —
     so it cannot half-succeed. A return with only store lines keeps the old path. */
  if (party.length) {
    if (fabrics.length) return { ok: false, error: "A fabric receipt and a yarn return are posted separately" };
    const { data, error } = await s.rpc("knitting_yarn_return_post", {
      p_order_id: orderId,
      p_header: input.header,
      p_returns: returns,
      p_party: party,
    });
    if (error) return { ok: false, error: error.message };
    const res = (data ?? {}) as { receipt_id: string | null; dc_ids: string[] | null };
    if (res.receipt_id) await writeAudit({ action: "knitting_receipt.posted", entityType: "knitting_receipt", entityId: res.receipt_id });
    for (const dc of res.dc_ids ?? []) await writeAudit({ action: "knitting_yarn.party_stock", entityType: "delivery_challan", entityId: dc });
    revalidateKnitting(orderId);
    for (const p of party) revalidateKnitting(p.to_order_id);
    revalidatePath("/purchase/dc");
    return { ok: true, id: res.receipt_id ?? res.dc_ids?.[0] ?? orderId };
  }

  const { data, error } = await s.rpc("knitting_receipt_post", {
    p_order_id: orderId,
    p_header: input.header,
    p_fabrics: fabrics,
    p_returns: returns,
  });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_receipt.posted", entityType: "knitting_receipt", entityId: String(data) });
  revalidateKnitting(orderId);
  revalidatePath("/purchase/dc");
  revalidatePath("/finance/payables");
  return { ok: true, id: String(data) };
}

/**
 * Close — ALWAYS DIRECT since 0837 (user 2026-11-12 dropped D1's MD approval): the balance at
 * the knitter is written off and the order closes now, over the Allowed Loss % or not. A balance
 * still needs a reason. The `knitting_close` workflow is no longer started from here.
 */
export async function closeKnittingOrder(orderId: string, reason: string): Promise<{ ok: true; outcome: "closed" } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to close a knitting order" };
  const s = await createClient();
  const { data, error } = await s.rpc("knitting_order_close", { p_order_id: orderId, p_reason: reason });
  if (error) return { ok: false, error: error.message };
  /* NO MD APPROVAL (user 2026-11-12, 0837): `knitting_order_close` always closes directly —
     over the Allowed Loss % too (the loss stays red on the receipt screen and the analysis). */
  if (data !== "closed") return { ok: false, error: "The knitting order did not close" };
  await writeAudit({ action: "knitting_order.closed", entityType: "process_order", entityId: orderId });
  revalidateKnitting(orderId);
  revalidatePath("/purchase/dc");
  return { ok: true, outcome: "closed" };
}

/**
 * Yarn already at the knitter on another Knitting Order, put on this one — no transport DC
 * (client 2026-11-11, 0833). One database call: the kg comes off the other order's DC lines and
 * a paper DC on this order carries it, so this order's cap, receipts and close work unchanged.
 */
export async function moveYarnAtKnitter(
  toOrderId: string,
  input: { from_yarn_id: string; to_yarn_id: string; kg: number; note: string | null },
): Promise<{ ok: true; id: string } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to move yarn between knitting orders" };
  if (!(input.kg > 0)) return { ok: false, error: "Enter the kg to move" };
  const s = await createClient();
  const { data, error } = await s.rpc("knitting_transfer_at_knitter", {
    p_from_yarn: input.from_yarn_id,
    p_to_yarn: input.to_yarn_id,
    p_kg: input.kg,
    p_note: input.note,
  });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_yarn.moved_at_knitter", entityType: "delivery_challan", entityId: String(data) });
  revalidateKnitting(toOrderId);
  revalidatePath("/purchase/dc");
  return { ok: true, id: String(data) };
}

/**
 * SEND YARN FROM THE PROGRAM ITSELF (client recording-1794374987319, user 2026-11-12: "merge the
 * yarn store & bin selection into the Knitting Program"). The rows the operator gave a Send Qty
 * become ONE Job Work DC on this order, dispatched at once through the same `saveProcessDc` →
 * `process_dc_dispatch` as every other DC — so the +1-bag cap, bin and lot checks and the stock
 * move are exactly the DC's. A row left at 0 stays open for a later DC (partial dispatch).
 *
 * Lines are addressed by POSITION (fabric n, yarn m): on a brand-new order the screen has no yarn
 * ids yet — they are given by the save that runs just before this, in the same click.
 */
export async function dispatchKnittingYarn(orderId: string, dcDate: string, sends: KnitSendLine[]): Promise<{ ok: true; id: string } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to send yarn" };
  const live = sends.filter((x) => x.kg > 0);
  if (!live.length) return { ok: false, error: "Enter a Send Qty on at least one yarn" };
  const doc = await getKnittingOrder(orderId);
  if (!doc) return { ok: false, error: "Knitting order not found" };
  const lines = [];
  for (const x of live) {
    const y = doc.fabrics[x.fabric_index]?.yarns[x.yarn_index];
    if (!y?.process_order_line_id) return { ok: false, error: "A yarn line is not on this order — reload and try again" };
    if (!x.store_id) return { ok: false, error: `${y.yarn_name}: pick the store it goes from` };
    lines.push({
      process_order_line_id: y.process_order_line_id,
      item_id: y.yarn_item_id,
      description: y.yarn_name,
      sent_qty: x.kg,
      from_store_id: x.store_id,
      bin_id: x.bin_id || null,
      lot_no: null,
      bags: x.bags,
      bag_weight_kg: x.bag_weight_kg,
    });
  }
  return saveProcessDc(null, { process_order_id: orderId, dc_date: dcDate, lines }, true);
}

/**
 * DC CAP, SET BY HAND on an issued (or draft) Knitting Order (client 2026-11-12, 0837): the most
 * this yarn row may send on Job Work DCs, when the truck or the lot released says otherwise.
 * `kg` null = back to the calculated cap (whole bags). The database refuses a cap below what has
 * already been sent, and an order waiting for the MD's close.
 */
export async function setKnittingDcCap(orderId: string, yarnId: string, kg: number | null): Promise<{ ok: true; cap: number } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to change a DC Cap" };
  if (kg != null && !(kg > 0)) return { ok: false, error: "The DC Cap must be more than 0 kg, or left blank" };
  const s = await createClient();
  const { data, error } = await s.rpc("knitting_set_dc_cap", { p_yarn: yarnId, p_kg: kg });
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    action: "knitting_order.dc_cap_changed",
    entityType: "process_order",
    entityId: orderId,
    metadata: { yarn_id: yarnId, dc_cap_kg: kg },
  });
  revalidateKnitting(orderId);
  return { ok: true, cap: Number(data) };
}
