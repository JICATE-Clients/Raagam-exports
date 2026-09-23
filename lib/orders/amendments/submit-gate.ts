import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  areaOpen,
  modulesOf,
  scopeFromJson,
} from "@/lib/orders/amendments/amendment-entry";
import {
  assortBalanceMessage,
  crossTabPoQtyMessage,
  totalQuantityPoQty,
  type BalanceRow,
} from "@/lib/orders/amendments/qty-balance";

/**
 * THE MODULE CATEGORY'S VALIDATION RULES, AT SUBMIT (doc/order/amenment
 * update.md §2 rule 2). The revised budget is what the MD approves; before it
 * goes, each module the amendment opened is held to its own rule:
 *
 *   - ORDER ENTRY → "re-verifying total style quantity matching": the order's
 *     STORED Style PO Qty against its Quantities PO Qty, and each destination
 *     against its own breakup — the double lock Order Entry's save applies
 *     (`qty-balance.ts`), re-asked of what was actually saved, so an order
 *     saved half-way through an edit cannot reach the MD.
 *   - FABRIC BOM → "forces a recalculation of yarn purchase weights before
 *     submission": the Fabric BOM must have been computed SINCE the entry
 *     opened. The freshness gate (`refuseUnreadyOrders`) already refuses a BOM
 *     whose basis moved; this also refuses one nobody re-ran after its own
 *     inputs were opened for change — a stamp older than the entry is a yarn
 *     weight nobody recomputed.
 *   - ORDER BUDGET → "re-calculates profit margin deltas against the
 *     baseline": done by `submitBudget` itself (the KPIs are recomputed there
 *     from the stored budget and the delta stored on the entry).
 *
 * The same arithmetic Order Entry's action uses — never restated.
 */

type Qty = {
  style_ref_no: string | null;
  po_qty: number | null;
  is_ratio_wise_pack: boolean | null;
  ratio_for: string | null;
  assort_lines: { is_pack_row: boolean | null; no_of_cartons: number | null; inners_per_carton: number | null; sizes: { qty: number | null }[] | null }[] | null;
};

async function styleQtyProblem(orderId: string, reNo: string): Promise<string | null> {
  const s = await createClient();
  const [styles, quantities] = await Promise.all([
    s.from("garment_order_amendment_styles").select("po_qty").eq("amendment_id", orderId),
    s
      .from("garment_order_amendment_quantities")
      .select(
        "style_ref_no, po_qty, is_ratio_wise_pack, ratio_for, " +
          "assort_lines:garment_order_amendment_assort_lines(is_pack_row, no_of_cartons, inners_per_carton, sizes:garment_order_amendment_assort_line_sizes(qty))",
      )
      .eq("amendment_id", orderId),
  ]);
  if (styles.error) throw new Error(`Could not read ${reNo}'s styles: ${styles.error.message}`);
  if (quantities.error) throw new Error(`Could not read ${reNo}'s quantities: ${quantities.error.message}`);
  const rows = (quantities.data ?? []) as unknown as Qty[];
  for (const q of rows) {
    const why = assortBalanceMessage(q as BalanceRow, q.is_ratio_wise_pack ? "assort" : "solid", q.style_ref_no ?? "");
    if (why) return `${reNo}: ${why}`;
  }
  const styleTotal = ((styles.data ?? []) as { po_qty: number | null }[]).reduce((a, r) => a + (Number(r.po_qty) || 0), 0);
  const cross = crossTabPoQtyMessage(styleTotal, totalQuantityPoQty(rows as BalanceRow[]));
  return cross ? `${reNo}: ${cross} Open Order Entry and make them match before sending the budget.` : null;
}

/**
 * The first reason an amended order is not ready for the MD, or null. Orders
 * under no open entry pass untouched (a first-time budget has no amendment).
 */
export async function amendmentSubmitProblem(orderIds: readonly string[]): Promise<string | null> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return null;
  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_revisions")
    .select(
      "id, entry_no, garment_order_id, amendment_type, amendment_types, scope, reopened_at, " +
        "order:garment_order_amendments!garment_order_id(code, sales_order:sales_orders(order_number))",
    )
    .eq("outcome", "open")
    .in("garment_order_id", ids);
  if (error) throw new Error(`Could not read the open amendments: ${error.message}`);

  type Row = {
    id: string;
    entry_no: string | null;
    garment_order_id: string;
    amendment_type: string;
    amendment_types: string[] | null;
    scope: unknown;
    reopened_at: string;
    order:
      | { code: string | null; sales_order: { order_number: string | null } | { order_number: string | null }[] | null }
      | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    const so = Array.isArray(r.order?.sales_order) ? r.order?.sales_order[0] : r.order?.sales_order;
    const reNo = so?.order_number ?? r.order?.code ?? "The order";
    const types = r.amendment_types?.length ? r.amendment_types : [r.amendment_type];
    const modules = modulesOf(types);
    const scope = scopeFromJson(r.scope);

    if (modules.includes("order_entry")) {
      const why = await styleQtyProblem(r.garment_order_id, reNo);
      if (why) return why;
    }

    if (areaOpen(scope, "fabric_bom")) {
      const { data: bom, error: bErr } = await s
        .from("order_fabric_boms")
        .select("computed_at")
        .eq("garment_order_id", r.garment_order_id)
        .maybeSingle();
      if (bErr) throw new Error(`Could not read ${reNo}'s Fabric BOM: ${bErr.message}`);
      const at = (bom as { computed_at: string | null } | null)?.computed_at ?? null;
      if (bom && (!at || at < r.reopened_at)) {
        return (
          `${reNo}: revision ${r.entry_no ?? ""} opened the Fabric BOM, and its yarn purchase weights have not been ` +
          `recalculated since — press Recalculate on the revision (or open its Fabric BOM tab and save it) before sending the budget.`
        );
      }
    }
  }
  return null;
}
