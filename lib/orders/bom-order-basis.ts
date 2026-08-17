import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RejectionTier } from "@/lib/masters/rejection-rule";
import type { OrderProductionInput } from "@/lib/orders/material-bom/requirement";

/**
 * A garment order, read as the thing a BOM multiplies.
 *
 * ## Why this is not in `material-bom-amendment/`
 *
 * Nothing here is about MATERIAL. It reads the order's Approval Qty rows, its
 * Combos tab, its excess percentage, its rejection rule and its assortment size
 * curve, and hands back the `OrderProductionInput` the requirement engines take.
 * Material BOM (step 3, `0418`) asked for it first; Fabric BOM (step 5, `0426`)
 * asks for exactly the same thing, and step 7's Budget will ask again.
 *
 * It was extracted rather than copied — for the reason `bom-status.ts` records
 * one file along, and for a sharper one here. `ORDER_SELECT` names four child
 * relationships, and PostgREST fails the WHOLE query when any one name stops
 * resolving; two copies of that string means the next schema change fixes one
 * screen and silently blanks the other. `orderProductionInput`'s assortment
 * flattening carries the same risk — its own comment already warns that two
 * callers reading one tree two ways is how two screens start disagreeing about
 * an order's size curve.
 */
// ---------------------------------------------------------------------------
// The order, and what the requirement needs from it
// ---------------------------------------------------------------------------

/**
 * The garment order's own tabs, as PostgREST returns them.
 *
 * ONE UNRESOLVABLE RELATIONSHIP FAILS THE WHOLE QUERY, not just its branch —
 * the standing warning on `lib/orders/amendments/service.ts`'s much larger
 * select. So this asks for the four children the requirement actually needs and
 * nothing else: the more names in the string, the more ways an unrelated schema
 * change blanks this screen.
 */
export const ORDER_SELECT =
  "id, code, po_no, amend_date, delivery_date, excess_pct, rejection_rule_id, " +
  "customer:customers(id,code,name), " +
  "sales_order:sales_orders(id,order_number), " +
  "styles:garment_order_amendment_styles(style_ref_no), " +
  "approval_qtys:garment_order_amendment_approval_qtys(style_ref_no,combo,qty,approval_qty), " +
  "combos:garment_order_amendment_combos(style_ref_no,combo), " +
  "quantities:garment_order_amendment_quantities(style_ref_no, " +
  "assort_lines:garment_order_amendment_assort_lines(combo,no_of_cartons, " +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty)))";

export type OrderRow = {
  id: string;
  code: string | null;
  po_no: string | null;
  amend_date: string;
  delivery_date: string | null;
  excess_pct: number | null;
  rejection_rule_id: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  sales_order: { id: string; order_number: string | null } | null;
  styles: { style_ref_no: string | null }[] | null;
  approval_qtys:
    | { style_ref_no: string | null; combo: string | null; qty: number; approval_qty: number }[]
    | null;
  combos: { style_ref_no: string | null; combo: string | null }[] | null;
  quantities:
    | {
        style_ref_no: string | null;
        assort_lines:
          | {
              combo: string | null;
              no_of_cartons: number | null;
              sizes: { size_id: string | null; qty: number | null }[] | null;
            }[]
          | null;
      }[]
    | null;
};

/**
 * The order shaped for `lib/orders/material-bom/requirement.ts`.
 *
 * The assort tree is flattened to (style, combo, size, pieces) with
 * `no_of_cartons x that size's per-carton qty` — the SAME multiplication
 * `pricingWeights` does in `amendment-screen.tsx` for Average Rate. Two callers
 * reading one tree two ways is how two screens start disagreeing about an
 * order's size curve, so the expression is copied deliberately and named here.
 *
 * `sizeName` is supplied by the caller that has the lookups; without it a slice
 * is labelled with its uuid, which is legible to nobody.
 */
export function orderProductionInput(
  row: OrderRow,
  tiersById: Map<string, RejectionTier[]>,
  sizeName?: (id: string) => string,
): OrderProductionInput {
  const assortSizes = (row.quantities ?? []).flatMap((q) =>
    (q.assort_lines ?? []).flatMap((l) =>
      (l.sizes ?? []).map((z) => ({
        style_ref_no: q.style_ref_no,
        combo: l.combo,
        size_id: z.size_id,
        qty: (Number(l.no_of_cartons) || 0) * (Number(z.qty) || 0),
      })),
    ),
  );

  return {
    excessPct: Number(row.excess_pct) || 0,
    // A rule NAMED is what makes a tier gap a refusal rather than a zero buffer
    // (see `productionTarget`). Read off the order, never inferred from whether
    // tiers happened to resolve.
    rejectionRuleChosen: !!row.rejection_rule_id,
    tiers: row.rejection_rule_id ? (tiersById.get(row.rejection_rule_id) ?? null) : null,
    approvals: (row.approval_qtys ?? []).map((a) => ({
      style_ref_no: a.style_ref_no,
      combo: a.combo,
      qty: Number(a.qty) || 0,
      approval_qty: Number(a.approval_qty) || 0,
    })),
    combos: (row.combos ?? []).map((c) => ({
      style_ref_no: c.style_ref_no,
      combo: c.combo,
    })),
    assortSizes,
    sizeName,
  };
}

/**
 * Every rejection rule's tiers, keyed by id.
 *
 * `blocked` rows are SELECTED, not filtered: a rule switched off after an order
 * named it must still resolve, or that order's Projection — and so its whole
 * material plan — would silently change. Same call `getRejectionRuleRows` makes
 * in the amendment service.
 */
export async function rejectionTiersById(): Promise<Map<string, RejectionTier[]>> {
  const s = await createClient();
  const { data } = await s
    .from("garment_rejection_rules")
    .select(
      "id, lines:garment_rejection_rule_lines(from_value,to_value,rejection_allowance,allowance_type)",
    );
  const out = new Map<string, RejectionTier[]>();
  for (const r of (data ?? []) as unknown as { id: string; lines: RejectionTier[] | null }[]) {
    out.set(r.id, r.lines ?? []);
  }
  return out;
}

export async function sizeNameFn(): Promise<(id: string) => string> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, name")
    .eq("kind", "size");
  const byId = new Map((data ?? []).map((r) => [r.id as string, r.name as string]));
  return (id: string) => byId.get(id) ?? id;
}

/**
 * One order's production input, for the editor.
 *
 * Fetched when an order is PICKED rather than shipped with the form data for
 * every order: the requirement recalculates as the operator types, but only the
 * line changes — the order's approval quantities do not — so this is one round
 * trip per order, not per keystroke.
 */
export async function getOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionInput | null> {
  const s = await createClient();
  const [tiers, sizeName, res] = await Promise.all([
    rejectionTiersById(),
    sizeNameFn(),
    s.from("garment_order_amendments").select(ORDER_SELECT).eq("id", garmentOrderId).maybeSingle(),
  ]);
  if (!res.data) return null;
  return orderProductionInput(res.data as unknown as OrderRow, tiers, sizeName);
}
