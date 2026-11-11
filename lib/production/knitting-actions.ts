"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { refuseReopenedBudget } from "@/lib/purchase/bom-ceiling-service";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getKnitCandidates } from "./knitting-service";
import type { KnitCandidatesResult, KnitReceiptInput, KnittingOrderInput } from "./knitting-types";

/**
 * KNITTING HUB writes (DB 0825). The save is ONE call to `knitting_order_save`, which writes
 * the process order, its fabrics, yarns and order lines in one transaction and computes every
 * derived figure itself — required kg, bags, the DC cap — from the inputs alone.
 */

type Fail = { ok: false; error: string };
const BASE = "/production/knitting-hub";

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
  const reopened = await refuseReopenedBudget([{ sales_order_id: input.sales_order_id }]);
  if (reopened) return { ok: false, error: reopened };

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
    .select("sales_order_id, process_type, status, fabrics:process_order_knit_fabrics(id)")
    .eq("id", id)
    .maybeSingle();
  if (poErr) return { ok: false, error: `Could not read the knitting order: ${poErr.message}` };
  const row = po as { sales_order_id: string | null; process_type: string; status: string; fabrics: { id: string }[] | null } | null;
  if (!row || row.process_type !== "knitting") return { ok: false, error: "Knitting order not found" };
  if (row.status !== "draft") return { ok: false, error: "Only a draft knitting order can be issued" };
  if (!row.fabrics?.length) return { ok: false, error: "Add a fabric and save before issuing" };
  const reopened = await refuseReopenedBudget([{ sales_order_id: row.sales_order_id }]);
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
  const { data: dcs, error: dcErr } = await s
    .from("delivery_challans")
    .select("id")
    .eq("process_order_id", id)
    .neq("status", "cancelled")
    .limit(1);
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
  if (!fabrics.length && !returns.length) return { ok: false, error: "Enter the fabric received, or the yarn returned" };
  if (!input.header.receipt_date) return { ok: false, error: "Pick the receipt date" };
  const s = await createClient();
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
 * Close (D1). Within the Allowed Loss % the balance is written off and the order closes now.
 * Past it, the order waits and the MD gets a `knitting_close` approval; the MD's approve does
 * the same write-off. If the approval cannot start, the pending flag is undone so the order
 * is never stranded.
 */
export async function closeKnittingOrder(orderId: string, reason: string): Promise<{ ok: true; outcome: "closed" | "pending" } | Fail> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to close a knitting order" };
  const s = await createClient();
  const { data, error } = await s.rpc("knitting_order_close", { p_order_id: orderId, p_reason: reason });
  if (error) return { ok: false, error: error.message };
  const outcome = data === "pending" ? "pending" : "closed";

  if (outcome === "pending") {
    const [{ data: po }, { data: bal }] = await Promise.all([
      s.from("process_orders").select("code, allowed_loss_pct, vendor:master_vendors!vendor_id(name), so:sales_orders!sales_order_id(order_number)").eq("id", orderId).maybeSingle(),
      s.rpc("knitting_order_balance", { p_order_id: orderId }),
    ]);
    const row = (po ?? {}) as { code?: string | null; allowed_loss_pct?: number | null; vendor?: { name: string } | null; so?: { order_number: string | null } | null };
    const b = ((bal ?? []) as { issued_kg: number; balance_kg: number; loss_pct: number | null }[])[0];
    const started = await startApproval({
      workflowKey: WORKFLOWS.knitting_close.key,
      subjectTable: WORKFLOWS.knitting_close.subjectTable,
      subjectId: orderId,
      /* Frozen as sent — what the MD's alert and inbox card say. */
      context: {
        ko_code: row.code ?? null,
        knitter: row.vendor?.name ?? null,
        order_no: row.so?.order_number ?? null,
        yarn_sent_kg: b ? Number(b.issued_kg) : null,
        balance_kg: b ? Number(b.balance_kg) : null,
        loss_pct: b?.loss_pct == null ? null : Number(b.loss_pct),
        allowed_loss_pct: row.allowed_loss_pct == null ? null : Number(row.allowed_loss_pct),
        reason: reason.trim().toUpperCase(),
      },
    });
    if (!started.ok) {
      await s.rpc("knitting_order_close_withdraw", { p_order_id: orderId });
      return { ok: false, error: `The close could not be sent to the MD: ${started.error}` };
    }
  }
  await writeAudit({ action: outcome === "closed" ? "knitting_order.closed" : "knitting_order.close_requested", entityType: "process_order", entityId: orderId });
  revalidateKnitting(orderId);
  revalidatePath("/purchase/dc");
  return { ok: true, outcome };
}
