import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { lineKeyOf, type RequirementLine } from "@/lib/purchase/re-po/types";

/**
 * ABOVE-BUDGET ESCALATION (user 2026-10-27). A PO whose rate is above the approved
 * order budget goes to the MD (`pending_approval`, 0737) and its print stays locked
 * until approval. This file is the three things around that decision:
 *
 * - the MD's alert when such a PO is sent, naming the items above budget;
 * - the raiser's alert when the MD decides (Approve · Revise · Reject);
 * - the MD's variance — budget rate beside the quoted rate, and what the
 *   difference takes off the order's profit — read through `po_budget_rates`
 *   (0761), which answers only a `materials_purchase:approve` holder. The
 *   Purchase Manager still never sees the budget figure (spec point 7).
 *
 * Both alerts reuse the approval events — "Approval needed" (mandatory: it moves
 * work) and "Approval decided" — so Administration ▸ Notifications already lists
 * them. Neither is ever allowed to fail the action that raised it.
 */

const APPROVERS = { permission: { module: "materials_purchase", action: "approve" } } as const;

/** The MD's alert: which items are above budget, and the Purchase Manager's reason. */
export async function notifyPoAboveBudget(po: { id: string; code: string | null; items: string[]; reason: string | null; total: string }) {
  try {
    const shown = po.items.slice(0, 3).join(", ");
    const more = po.items.length > 3 ? ` +${po.items.length - 3} more` : "";
    await notify("approval.pending", APPROVERS, {
      title: `PO ${po.code ?? ""} is above budget — needs your approval`.replace("  ", " "),
      body: [`${shown}${more} · total ${po.total}`, po.reason ? `Reason: ${po.reason}` : null].filter(Boolean).join("\n"),
      href: `/purchase/orders/${po.id}`,
      type: "warning",
    });
  } catch {
    // An alert never fails the submit.
  }
}

/** The raiser's alert once the MD decides. */
export async function notifyPoDecided(poId: string, outcome: "approved" | "revise" | "rejected", note: string | null) {
  try {
    const s = await createClient();
    const { data } = await s.from("purchase_orders").select("code, created_by").eq("id", poId).maybeSingle();
    const row = data as { code: string | null; created_by: string | null } | null;
    if (!row?.created_by) return;
    const word = outcome === "approved" ? "approved — it can be printed now" : outcome === "revise" ? "sent back for revision" : "rejected";
    await notify(
      "approval.decided",
      { userId: row.created_by },
      {
        title: `PO ${row.code ?? ""} ${word}`.replace("  ", " "),
        body: note ? `MD: ${note}` : undefined,
        href: outcome === "revise" ? "/purchase/requirement-po" : `/purchase/orders/${poId}`,
        type: outcome === "approved" ? "success" : outcome === "revise" ? "warning" : "danger",
      },
    );
  } catch {
    // Never fail the decision over a notification.
  }
}

/** One PO line, as far as the variance needs it. */
type VarianceLine = {
  id: string;
  item_id: string | null;
  uom_id: string | null;
  quantity: number | string;
  unit_price: number | string;
  req_key?: string | null;
  garment_order_id?: string | null;
  iwo_id?: string | null;
};

/** Per PO line: the budget rate in RUPEES, or null when the line has no approved budget. */
export type PoVariance = Record<string, number | null>;

/**
 * The budget rate behind each line, for the MD. Takes the requirement lines the page
 * already read (for the RE numbers), so the slice and colour cost no second round trip. `null` for the whole result when
 * the reader may not see budget figures (or the read failed) — the screen then
 * shows the PO without the columns rather than a column of wrong blanks.
 */
export async function getPoBudgetVariance(lines: readonly VarianceLine[], reqLines: readonly RequirementLine[]): Promise<PoVariance | null> {
  const reqByKey = new Map(reqLines.map((r) => [lineKeyOf(r), r]));
  const probe = lines.flatMap((l) => {
    const src = l.garment_order_id ?? l.iwo_id;
    const req = src && l.req_key ? reqByKey.get(`${src}::${l.req_key}`) : undefined;
    // An IWO / SWO line has no order budget — it is "no budget", and asks nothing.
    if (!req || !l.garment_order_id || !l.item_id) return [];
    return [{ key: l.id, garment_order_id: l.garment_order_id, item_id: l.item_id, uom_id: l.uom_id, slice_label: req.slice_label, colour: req.colour, rate: null }];
  });
  const out: PoVariance = Object.fromEntries(lines.map((l) => [l.id, null]));
  if (!probe.length) return out;
  const s = await createClient();
  const { data, error } = await s.rpc("po_budget_rates", { p_lines: probe });
  if (error) return null;
  for (const r of (data ?? []) as { key: string; budget_rate: number | string | null }[]) out[r.key] = r.budget_rate == null ? null : Number(r.budget_rate);
  return out;
}
