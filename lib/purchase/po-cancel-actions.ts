"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { actOnSubject, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { poCancelRequestInput, type PoCancelRequestInput } from "./extras-types";

/**
 * PO CANCELLATION THROUGH MY APPROVALS (0785, user 2026-10-31).
 *
 * An approved or partly received PO is no longer cancelled on the spot. The
 * Purchase Manager REQUESTS it — the whole PO, or chosen lines with a quantity
 * each, the reason mandatory — and a `po_cancellation` run goes to the MD. Only
 * the run's final approve cuts the lines (`po_cancellation_apply_decision`), which
 * is what reopens the requirement balance on Raise PO. Until then the PO is
 * unchanged; a reject leaves it as it was.
 */

type R = { ok: true } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });

function revalidateCancel(poId?: string) {
  revalidatePath("/purchase/po-cancellations");
  if (poId) revalidatePath(`/purchase/orders/${poId}`);
  revalidatePath("/purchase");
}

export async function requestPoCancellation(raw: PoCancelRequestInput): Promise<R> {
  if (!(await can("materials_purchase", "edit"))) return bad("Forbidden");
  const p = poCancelRequestInput.safeParse(raw);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const input = p.data;
  const s = await createClient();

  const [{ data: poRow, error: poErr }, { data: lineRows, error: lErr }] = await Promise.all([
    s.from("purchase_orders").select("id, code, status, po_type, foreign_currency_code").eq("id", input.purchase_order_id).maybeSingle(),
    s
      .from("po_line_items")
      .select("id, description, quantity, received_qty, closed_qty, balance_closed_qty, unit_price, gst_pct, sort_order, uoms!uom_id(code)")
      .eq("purchase_order_id", input.purchase_order_id),
  ]);
  if (poErr) return bad(poErr.message);
  if (lErr) return bad(lErr.message);
  const po = poRow as { id: string; code: string | null; status: string; po_type: string | null; foreign_currency_code: string | null } | null;
  if (!po) return bad("PO not found");
  if (po.status === "draft") return bad("A draft PO is cancelled directly — it has not gone to the vendor");
  if (po.status === "pending_approval") return bad("This PO is waiting for approval — reject it on its own page instead");
  if (!["approved", "partially_received"].includes(po.status)) return bad(`A ${po.status} PO cannot be cancelled`);

  const lines = ((lineRows ?? []) as unknown as {
    id: string; description: string | null; quantity: number; received_qty: number; closed_qty: number;
    balance_closed_qty: number; unit_price: number; gst_pct: number | null; sort_order: number | null;
    uoms: { code: string | null } | null;
  }[]).map((l) => ({
    ...l,
    open: Math.max(
      (Number(l.quantity) || 0) - (Number(l.received_qty) || 0) - (Number(l.closed_qty) || 0) - (Number(l.balance_closed_qty) || 0),
      0,
    ),
  }));
  const byId = new Map(lines.map((l) => [l.id, l]));

  /* WHOLE = every line's open balance. PARTIAL = the lines the operator chose, each
     at or under what is still open (received goods are never cancelled). */
  const picked =
    input.scope === "whole"
      ? lines.filter((l) => l.open > 0).map((l) => ({ po_line_item_id: l.id, cancel_qty: Math.round(l.open * 1000) / 1000 }))
      : input.lines.filter((l) => l.cancel_qty > 0);
  if (picked.length === 0) return bad(input.scope === "whole" ? "Nothing on this PO is still open to cancel" : "Enter a cancel qty on at least one line");
  for (const l of picked) {
    const line = byId.get(l.po_line_item_id);
    if (!line) return bad("A line is no longer on this PO — reload");
    if (l.cancel_qty > line.open + 0.0005)
      return bad(`${line.description || "A line"}: only ${line.open} is still open — cancel at most that`);
  }

  const { data: req, error: rErr } = await s
    .from("po_cancellation_requests")
    .insert({ purchase_order_id: po.id, scope: input.scope, reason: input.reason })
    .select("id, code")
    .single();
  if (rErr) {
    return bad(
      rErr.code === "23505" ? "A cancellation for this PO is already waiting for the MD" : rErr.message,
    );
  }
  const reqRow = req as { id: string; code: string | null };

  const { error: rlErr } = await s.from("po_cancellation_request_lines").insert(
    picked.map((l, i) => ({
      request_id: reqRow.id,
      po_line_item_id: l.po_line_item_id,
      cancel_qty: l.cancel_qty,
      open_qty: byId.get(l.po_line_item_id)!.open,
      sort_order: i,
    })),
  );
  if (rlErr) {
    await s.from("po_cancellation_requests").delete().eq("id", reqRow.id);
    return bad(`The lines could not be saved: ${rlErr.message}`);
  }

  const cur = po.po_type === "import" ? (po.foreign_currency_code ?? "") : "₹";
  const value = picked.reduce((a, l) => {
    const line = byId.get(l.po_line_item_id)!;
    return a + l.cancel_qty * (Number(line.unit_price) || 0) * (1 + (Number(line.gst_pct) || 0) / 100);
  }, 0);
  const started = await startApproval({
    workflowKey: WORKFLOWS.po_cancellation.key,
    subjectTable: WORKFLOWS.po_cancellation.subjectTable,
    subjectId: reqRow.id,
    /* Frozen as sent — what the MD's alert and inbox card say. */
    context: {
      request_code: reqRow.code,
      po_id: po.id,
      po_code: po.code,
      scope: input.scope,
      reason: input.reason,
      currency: cur,
      cancel_value: Math.round(value * 100) / 100,
      lines: picked.map((l) => {
        const line = byId.get(l.po_line_item_id)!;
        return {
          po_line_item_id: l.po_line_item_id,
          item: line.description,
          uom: line.uoms?.code ?? null,
          ordered_qty: Number(line.quantity) || 0,
          received_qty: Number(line.received_qty) || 0,
          open_qty: line.open,
          cancel_qty: l.cancel_qty,
        };
      }),
    },
  });
  if (!started.ok) {
    // No run → nobody could decide it. Take the request back rather than strand it.
    await s.from("po_cancellation_requests").delete().eq("id", reqRow.id);
    return bad(`Could not send it for approval: ${started.error}`);
  }

  await writeAudit({
    action: "purchase_order.cancellation_requested",
    entityType: "purchase_order",
    entityId: po.id,
    metadata: { request_id: reqRow.id, scope: input.scope, reason: input.reason },
  });
  revalidateCancel(po.id);
  return { ok: true };
}

/** Approve / reject from the Cancel Purchase Order screen — through the run. */
export async function decidePoCancellation(id: string, action: "approve" | "reject", reason?: string): Promise<R> {
  if (!(await can("materials_purchase", "approve"))) return bad("Forbidden");
  const why = reason?.trim();
  if (action === "reject" && !why) return bad("Give the reason for rejecting");
  const r = await actOnSubject({
    subjectTable: WORKFLOWS.po_cancellation.subjectTable,
    subjectId: id,
    action,
    comment: why,
    subjectPath: "/purchase/po-cancellations",
  });
  if (!r.ok) return bad("noRun" in r ? "No approval is running for this request" : r.error);
  await writeAudit({
    action: action === "approve" ? "po_cancellation.approved" : "po_cancellation.rejected",
    entityType: "po_cancellation_request",
    entityId: id,
    metadata: why ? { reason: why } : undefined,
  });
  revalidateCancel();
  revalidatePath("/purchase/requirement-po");
  revalidatePath("/purchase/orders");
  return { ok: true };
}
