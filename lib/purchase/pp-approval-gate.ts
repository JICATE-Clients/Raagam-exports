/**
 * THE BULK YARN PO LOCK (doc/ui/order/taupdate.md §3 Rule 2, "Yarn Purchase
 * Based") — a sibling of `refuseUnsettledMaterials` (`bom-ceiling-service.ts`)
 * in shape, and of the Cutting Room Safety Lock (`lib/ta/worklist-actions.ts`
 * `cuttingBlockedReason`) in what it enforces, but neither of those is this.
 *
 * ## WHAT IT REFUSES, AND WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * An order in `pp_approval_trigger_mode = 'YARN_PURCHASE_BASED'` (0554) buys
 * only sample yarn upfront and holds bulk yarn purchase until the buyer has
 * approved the PP Sample — the credit-period protection 90-120 day orders
 * need, because bulk yarn bought on day one burns 30-60 days of a mill's
 * credit window before a sample is even reviewed.
 *
 * This function is the OTHER HALF of the toggle from the Cutting Room Safety
 * Lock, never a replacement for it: `cuttingBlockedReason` keeps gating
 * CUTTING exactly as it does today, for every order, regardless of this
 * column — a `YARN_PURCHASE_BASED` order does not get an extra free pass on
 * cutting from this file. This file only ever blocks a YARN purchase; it
 * never reads or touches the T&A worklist.
 *
 * ## THE SAME "OPTIONAL, NOT MERELY NULLABLE" SHAPE AS ITS SIBLINGS
 *
 * `sales_order_id` / `item_id` absent means general stock buying with no
 * order or material named — not measurable, so not refused. A gate that
 * refused what it cannot measure would stop ordinary purchasing.
 */
import { createClient } from "@/lib/supabase/server";

export async function refuseUnapprovedYarnPurchase(
  lines: readonly {
    sales_order_id?: string | null;
    item_id?: string | null;
  }[],
): Promise<string | null> {
  // Grouped by order, same reason `refuseUnsettledMaterials` groups: the
  // gate is per order and most POs name one.
  const byOrder = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.sales_order_id || !l.item_id) continue;
    const forOrder = byOrder.get(l.sales_order_id) ?? new Set<string>();
    forOrder.add(l.item_id);
    byOrder.set(l.sales_order_id, forOrder);
  }
  if (byOrder.size === 0) return null;

  const s = await createClient();

  // ONE batched pass to resolve "is this item Yarn", across every candidate
  // line at once — the same two-query-plus-Map shape
  // `material-bom-amendment/service.ts`'s `getMaterialRows` already uses to
  // turn `items.item_class_id` into the class CODE, since `item_class_id`
  // points at `config_lookups` (kind='item_class'), not a dedicated table.
  const allItemIds = [...new Set([...byOrder.values()].flatMap((set) => [...set]))];
  const [{ data: itemRows }, { data: classRows }] = await Promise.all([
    s.from("items").select("id, item_class_id").in("id", allItemIds),
    s.from("config_lookups").select("id, code").eq("kind", "item_class"),
  ]);
  const yarnClassIds = new Set(
    ((classRows ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "YARN")
      .map((c) => c.id),
  );
  const yarnItemIds = new Set(
    ((itemRows ?? []) as { id: string; item_class_id: string | null }[])
      .filter((r) => r.item_class_id && yarnClassIds.has(r.item_class_id))
      .map((r) => r.id),
  );
  // Cheap exit: nothing on this payload is Yarn, so no order needs checking.
  if (yarnItemIds.size === 0) return null;

  for (const [salesOrderId, itemIds] of byOrder) {
    if (![...itemIds].some((id) => yarnItemIds.has(id))) continue;

    // sales_orders -> the garment order documents raised against it, RECORDED
    // ONLY (`is_draft = false`) — the same filter `bom-ceiling-service.ts`
    // applies for the same reason: a draft is somebody's half-finished
    // thinking, and this gate should not act on it.
    const { data: goRows } = await s
      .from("garment_order_amendments")
      .select("id, production_based_pp_approval, pp_approval_trigger_mode")
      .eq("sales_order_id", salesOrderId)
      .eq("is_draft", false);

    const gated = ((goRows ?? []) as {
      id: string;
      production_based_pp_approval: boolean | null;
      pp_approval_trigger_mode: string | null;
    }[]).filter(
      (g) =>
        g.production_based_pp_approval !== false &&
        g.pp_approval_trigger_mode === "YARN_PURCHASE_BASED",
    );
    // This sales order names no amendment in Yarn-Purchase-Based mode —
    // nothing to gate, same as `cuttingBlockedReason`'s own early returns.
    if (gated.length === 0) continue;

    // MATCHED BY `short_name` CONVENTION, never a foreign key — the exact
    // convention `cuttingBlockedReason` already uses to bridge PP Sample into
    // a gate, so the two locks can never disagree about which approval row
    // means "PP Sample".
    const { data: approval, error: approvalError } = await s
      .from("ta_approvals")
      .select("id")
      .ilike("short_name", "PPSAMPLE")
      .maybeSingle();
    // No PP Sample milestone in this database at all — nothing to gate on.
    if (approvalError || !approval) continue;

    const { data: trackers } = await s
      .from("garment_order_amendment_ta_approvals")
      .select("amendment_id, status")
      .in(
        "amendment_id",
        gated.map((g) => g.id),
      )
      .eq("approval_id", approval.id);

    const statusByAmendment = new Map(
      ((trackers ?? []) as { amendment_id: string; status: string }[]).map((t) => [
        t.amendment_id,
        t.status,
      ]),
    );

    // PER AMENDMENT, same as `cuttingBlockedReason`: a gated amendment with no
    // tracker row never asked for a PP Sample and is not blocked by it. Where
    // more than one non-draft amendment names this sales order (the document
    // is amendable), ANY one of them still holding an unapproved PP Sample
    // refuses the whole order's yarn buying — the safer reading for a
    // purchasing lock than letting one approved copy clear a stale one.
    const blocking = gated.some((g) => {
      const status = statusByAmendment.get(g.id);
      return status !== undefined && status !== "approved";
    });
    if (!blocking) continue;

    return "Bulk Yarn PO is locked until PP Sample is Approved on the Approvals Worklist (Yarn Purchase Based mode).";
  }
  return null;
}
