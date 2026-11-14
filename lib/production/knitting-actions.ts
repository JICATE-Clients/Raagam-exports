"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { refuseReopenedBudget } from "@/lib/purchase/bom-ceiling-service";
import { getKnitCandidates, getKnittingOrder } from "./knitting-service";
import { saveProcessDc } from "@/lib/stores/process-dc-actions";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { knitSourceKey } from "./knitting-types";
import type { KnitCandidatesResult, KnitGrnInput, KnitReceiptInput, KnitSendLine, KnittingOrderInput } from "./knitting-types";

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

/**
 * PARTIAL RE ALLOCATION (0847, user 2026-11-14): a slice's Program Qty may not exceed its BALANCE —
 * the Fabric BOM's kg less what PLACED Knitting Orders of that RE already hold (this order left out).
 * Checked here because the BOM requirement of a slice is assembled in TypeScript (getKnitCandidates);
 * a short-closed slice is refused by the database too (`knitting_fabric_placed_by`). Null = fine.
 */
async function knitBalanceProblem(
  orderId: string | null,
  lines: { sales_order_id: string | null; fabric_item_id: string; source_key: string | null; finished_dia: string | null; width_form: string | null; programmed_kg: number }[],
): Promise<string | null> {
  const byRe = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.sales_order_id) continue;
    byRe.set(l.sales_order_id, [...(byRe.get(l.sales_order_id) ?? []), l]);
  }
  for (const [re, reLines] of byRe) {
    const cand = await getKnitCandidates(re, orderId);
    if (!cand.ok) continue; // the save's own checks speak for an RE with no current Fabric BOM
    const bySlice = new Map(cand.candidates.map((c) => [c.key, c]));
    const asked = new Map<string, number>();
    for (const l of reLines) {
      const key = l.source_key || knitSourceKey(l.fabric_item_id, l.finished_dia, l.width_form);
      asked.set(key, (asked.get(key) ?? 0) + Number(l.programmed_kg || 0));
    }
    for (const [key, kg] of asked) {
      const c = bySlice.get(key);
      if (!c) continue; // a line no longer on the BOM keeps what it had
      if (c.short_closed) return `${c.fabric_name}: its balance was short-closed (${c.short_closed.reason}) — reopen it first`;
      const balance = Math.max(0, Math.round((c.bom_kg - c.placed_kg) * 1000) / 1000);
      if (kg > balance + 0.0005) {
        return `${c.fabric_name}${c.finish_dia ? ` (Fin Dia ${c.finish_dia})` : ""}: Program Qty ${kg} kg is more than the balance ${balance} kg (RE ${c.bom_kg} kg − already placed ${c.placed_kg} kg)`;
      }
    }
  }
  return null;
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

  const over = await knitBalanceProblem(
    id,
    input.fabrics.map((f) => ({ ...f, sales_order_id: f.sales_order_id ?? input.sales_order_id })),
  );
  if (over) return { ok: false, error: over };

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
export async function issueKnittingOrder(id: string): Promise<{ ok: true; sentToMd?: boolean } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data: po, error: poErr } = await s
    .from("process_orders")
    .select("code, sales_order_id, process_type, status, is_by_vendor, total_amount, fabrics:process_order_knit_fabrics(id, sales_order_id)")
    .eq("id", id)
    .maybeSingle();
  if (poErr) return { ok: false, error: `Could not read the knitting order: ${poErr.message}` };
  const row = po as {
    code: string | null;
    sales_order_id: string | null;
    process_type: string;
    status: string;
    is_by_vendor: boolean | null;
    total_amount: number | null;
    fabrics: { id: string; sales_order_id: string | null }[] | null;
  } | null;
  if (!row || row.process_type !== "knitting") return { ok: false, error: "Knitting order not found" };
  if (row.status !== "draft") return { ok: false, error: "Only a draft knitting order can be issued" };
  if (!row.fabrics?.length) return { ok: false, error: "Add a fabric and save before issuing" };
  const res = [...new Set([row.sales_order_id, ...row.fabrics.map((f) => f.sales_order_id)].filter((x): x is string => !!x))];
  const reopened = await refuseReopenedBudget(res.map((sales_order_id) => ({ sales_order_id })));
  if (reopened) return { ok: false, error: reopened };

  /* THE BALANCE AGAIN AT ISSUE (0847): two drafts may each have taken the whole balance; the
     first to be issued wins, the second is told what is left. */
  const { data: kf } = await s
    .from("process_order_knit_fabrics")
    .select("sales_order_id, fabric_item_id, source_key, finished_dia, width_form, programmed_kg")
    .eq("process_order_id", id);
  const over = await knitBalanceProblem(
    id,
    ((kf ?? []) as { sales_order_id: string | null; fabric_item_id: string; source_key: string | null; finished_dia: string | null; width_form: string | null; programmed_kg: number }[]).map((f) => ({
      ...f,
      sales_order_id: f.sales_order_id ?? row.sales_order_id,
      programmed_kg: Number(f.programmed_kg),
    })),
  );
  if (over) return { ok: false, error: over };

  /* NET RATE vs BUDGET (0845, user 2026-11-14): a line above its RE's approved budget Knitting
     rate — or with no approved budget rate — goes to the MD in My Approvals instead of issuing.
     The trigger `trg_proc_k_rate_gate` refuses the status change below on its own, so this is the
     friendly door, not the guard. */
  const { data: needsMd, error: reqErr } = await s.rpc("knitting_rate_request", { p_order_id: id });
  if (reqErr) return { ok: false, error: reqErr.message };
  if (needsMd) {
    const { data: lines } = await s.rpc("knitting_rate_lines", { p_order_id: id });
    const over = ((lines ?? []) as { fabric_name: string | null; rate_per_kg: number; budget_rate: number | null; over_budget: boolean }[])
      .filter((l) => l.over_budget)
      .map((l) => `${l.fabric_name ?? "Fabric"}: ₹${Number(l.rate_per_kg).toFixed(2)}/kg vs ${l.budget_rate == null ? "no approved budget" : `budget ₹${Number(l.budget_rate).toFixed(2)}/kg`}`);
    const started = await startApproval({
      workflowKey: WORKFLOWS.knitting_rate.key,
      subjectTable: WORKFLOWS.knitting_rate.subjectTable,
      subjectId: id,
      context: { ko_code: row.code, total: `₹ ${Number(row.total_amount ?? 0).toFixed(2)}`, above_budget: true, lines: over.join("; ") },
    });
    if (!started.ok) {
      // A run already open for this order is the one the MD is looking at — nothing to undo.
      if (!/already|open run|one open/i.test(started.error)) {
        await s.rpc("knitting_rate_request_undo", { p_order_id: id });
        return { ok: false, error: `Could not send the rate to the MD: ${started.error}` };
      }
    }
    await writeAudit({ action: "knitting_order.rate_sent_to_md", entityType: "process_order", entityId: id, metadata: { lines: over } });
    revalidateKnitting(id);
    return { ok: true, sentToMd: true };
  }

  /* BY VENDOR (0845): the knitter uses their own yarn — nothing to send, so the order goes
     straight to In Knitting, the state a fabric receipt needs. */
  const next = row.is_by_vendor ? "in_process" : "issued";
  const { error } = await s.from("process_orders").update({ status: next }).eq("id", id).eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_order.issued", entityType: "process_order", entityId: id });
  revalidateKnitting(id);
  return { ok: true };
}

/**
 * Cancel (Session 4, 0844) — also with yarn out: every sent yarn DC is undone in SQL (yarn back to
 * the store · bin · lot it left) and the order goes to Cancelled with a reason, which is what
 * frees its fabric slices for a new Knitting Order. Refused once anything has come back.
 */
export async function cancelKnittingOrder(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  if (!reason.trim()) return { ok: false, error: "Say why the knitting order is cancelled" };
  const s = await createClient();
  const { error } = await s.rpc("knitting_order_cancel", { p_order_id: id, p_reason: reason.trim() });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_order.cancelled", entityType: "process_order", entityId: id, metadata: { reason: reason.trim() } });
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
  // 0841: one SQL call — the checks, the order's draft / undone (cancelled) DCs, then the order.
  const { data: code, error } = await s.rpc("knitting_order_delete", { p_order_id: id });
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Other documents point at this order (a receipt or bill) — cancel it instead" };
    return { ok: false, error: error.message };
  }
  await writeAudit({ action: "knitting_order.deleted", entityType: "process_order", entityId: id, metadata: { code } });
  revalidateKnitting(id);
  revalidatePath("/purchase/dc");
  return { ok: true };
}

/**
 * UNDO A SENT YARN DC (user 2026-11-13, screenshot 4149: "return to the bin, that's all").
 * `knitting_dc_undo` (0841) puts the yarn back in the bin it left, cancels the DC and returns the
 * order to Issued — refused once anything has come back or moved at the knitter.
 */
export async function undoKnittingDc(orderId: string, dcId: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to undo a yarn DC" };
  const s = await createClient();
  const { error } = await s.rpc("knitting_dc_undo", { p_dc_id: dcId });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_dc.undone", entityType: "delivery_challan", entityId: dcId, metadata: { order_id: orderId } });
  revalidateKnitting(orderId);
  revalidatePath("/purchase/dc");
  return { ok: true };
}

/**
 * DELETE A FABRIC RECEIPT / YARN RETURN (user 2026-11-13, screenshot 4136: "add delete option …
 * for the child"). A posted receipt has moved stock, so `knitting_receipt_delete` (0839) UNDOES
 * it in one call — stock mirrored back, the DC lines' kg back at the knitter, the draft bill gone —
 * and refuses, with its own sentence, once that stock has moved on, the bill left draft, or the
 * Knitting Order closed.
 */
export async function deleteKnittingReceipt(id: string): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "delete"))) return { ok: false, error: "You do not have permission to delete a knitting receipt" };
  const s = await createClient();
  const { data: k } = await s.from("knitting_receipts").select("code, kind, process_order_id").eq("id", id).maybeSingle();
  const row = k as { code: string | null; kind: string; process_order_id: string } | null;
  if (!row) return { ok: false, error: "Receipt not found" };
  const { error } = await s.rpc("knitting_receipt_delete", { p_receipt_id: id });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_receipt.deleted", entityType: "knitting_receipt", entityId: id, metadata: { code: row.code, kind: row.kind } });
  revalidateKnitting(row.process_order_id);
  revalidatePath(row.kind === "fabric" ? "/process/knitting-receipts" : "/process/knitting-returns");
  revalidatePath("/purchase/dc");
  revalidatePath("/finance/payables");
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
 * MULTI-ORDER FABRIC GRN (Session 3, 0846) — one knitter's DC, fabric for several Knitting
 * Orders, ONE database call: each order's lines post as its own receipt under the GRN, and
 * Close & Completion closes every order on it in the same transaction, so nothing half-posts.
 */
export async function receiveKnittingGrn(input: KnitGrnInput): Promise<{ ok: true; id: string } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to receive knitted fabric" };
  const orders = input.orders.map((o) => ({ order_id: o.order_id, fabrics: o.fabrics.filter((f) => f.net_kg > 0) }));
  if (!orders.length) return { ok: false, error: "Pick the knitting orders this fabric came for" };
  if (!orders.some((o) => o.fabrics.length)) return { ok: false, error: "Enter the weight received for at least one fabric" };
  if (!input.header.receipt_date) return { ok: false, error: "Pick the GRN date" };
  if (!input.header.vendor_dc_no.trim() || !input.header.vendor_dc_date)
    return { ok: false, error: "Enter the Knitter DC No and Knitter DC Date the fabric came with" };
  const s = await createClient();
  const { data, error } = await s.rpc("knitting_grn_post", {
    p_header: input.header,
    p_orders: orders,
    p_close: input.close,
    p_reason: input.reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting_grn.posted", entityType: "knitting_grn", entityId: String(data) });
  for (const o of orders) {
    if (input.close) await writeAudit({ action: "knitting_order.closed", entityType: "process_order", entityId: o.order_id });
    revalidateKnitting(o.order_id);
  }
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

/**
 * SHORT CLOSE (0847, user 2026-11-14): the balance of one RE fabric slice is too small to knit and
 * will not get another Knitting Order — closed by hand with a reason. The slice then reads Fully
 * Placed in every picker, and the database refuses a new program on it. Reopen undoes it.
 */
export async function shortCloseKnitBalance(input: {
  salesOrderId: string;
  sliceKey: string;
  fabricItemId: string;
  kg: number;
  reason: string;
  orderId?: string | null;
}): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  if (!input.reason.trim()) return { ok: false, error: "Say why the balance is short-closed" };
  const s = await createClient();
  const { error } = await s.rpc("knitting_short_close", {
    p_sales_order_id: input.salesOrderId,
    p_slice_key: input.sliceKey,
    p_fabric_item_id: input.fabricItemId,
    p_kg: input.kg,
    p_reason: input.reason.trim(),
  });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting.balance_short_closed", entityType: "sales_order", entityId: input.salesOrderId, metadata: { slice: input.sliceKey, kg: input.kg, reason: input.reason.trim() } });
  revalidateKnitting(input.orderId ?? undefined);
  return { ok: true };
}

export async function reopenKnitBalance(input: { salesOrderId: string; sliceKey: string; orderId?: string | null }): Promise<{ ok: true } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { error } = await s.rpc("knitting_short_close_undo", { p_sales_order_id: input.salesOrderId, p_slice_key: input.sliceKey });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "knitting.balance_reopened", entityType: "sales_order", entityId: input.salesOrderId, metadata: { slice: input.sliceKey } });
  revalidateKnitting(input.orderId ?? undefined);
  return { ok: true };
}
