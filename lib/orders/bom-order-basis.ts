import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RejectionTier } from "@/lib/masters/rejection-rule";
import {
  basisFingerprint,
  isRefusal,
  totalProductionOf,
  type OrderProductionInput,
} from "@/lib/orders/material-bom/requirement";
import { BOM_STATUS_RANK, bomStatusOf, type BomStatus } from "@/lib/orders/bom-status";

// Re-exported so a caller of `bomTaskRows` can name the status its rows carry
// without importing a second module to do it.
export type { BomStatus };

/**
 * A garment order, read as the thing a BOM multiplies.
 *
 * ## Why this is not in `material-bom-amendment/`
 *
 * Nothing here is about MATERIAL. It reads the order's Approval Qty rows, its
 * Combos tab, its excess percentage, its rejection rule and its assortment size
 * curve, and hands back the `OrderProductionInput` the requirement engines take.
 * Material BOM (step 2, `0418`) asked for it first; Fabric BOM (step 3, `0426`)
 * asks for exactly the same thing, and step 5's Budget will ask again.
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
import { ASSORT_WEIGHT_SELECT, assortSizeWeights } from "@/lib/orders/assort-weights";

export const ORDER_SELECT =
  "id, code, po_no, amend_date, delivery_date, excess_pct, rejection_rule_id, rejection_pct, " +
  "customer:customers(id,code,name), " +
  "sales_order:sales_orders(id,order_number), " +
  /* THREE MORE COLUMNS ON THE STYLE (0495), for the Fabric BOM's Manual tab,
     whose header row is legacy's S No / StyleRefNo / StyleNo / ArticleNo and
     whose Component Unit is `unit_kind` (0471).

     WIDENED HERE RATHER THAN READ AGAIN. This is the same join on the same
     table for the same orders; a second query in the fabric service would be a
     second answer to "what styles does this order have", free to drift from
     this one. The Material BOM ignores the three — it maps `styles` to a count
     and a ref list — so the widening costs it nothing but the bytes. */
  "styles:garment_order_amendment_styles(style_ref_no, article_no, unit_kind, " +
  "style:garment_styles(id, code)), " +
  "approval_qtys:garment_order_amendment_approval_qtys(style_ref_no,combo,qty,approval_qty), " +
  "combos:garment_order_amendment_combos(style_ref_no,combo), " +
  // THE FRAGMENT COMES FROM THE RULE, not retyped beside it. `assortSizeWeights`
  // cannot answer without the assortment type and the inners, so the two travel
  // together — a caller that selects less would compile and return zeroes.
  `quantities:garment_order_amendment_quantities(${ASSORT_WEIGHT_SELECT})`;

export type OrderRow = {
  id: string;
  code: string | null;
  po_no: string | null;
  amend_date: string;
  delivery_date: string | null;
  excess_pct: number | null;
  rejection_rule_id: string | null;
  /** The order's flat rejection allowance (0531) — see `OrderProductionInput.rejectionPct`. */
  rejection_pct: number | null;
  customer: { id: string; code: string | null; name: string } | null;
  sales_order: { id: string; order_number: string | null } | null;
  styles:
    | {
        style_ref_no: string | null;
        article_no: string | null;
        /** 'pcs' | 'sets' (0471). */
        unit_kind: string | null;
        /** The Style master row, for its code. NULL where the order names a
         *  style by ref only, which 0457 made an ordinary state. */
        style: { id: string; code: string | null } | null;
      }[]
    | null;
  approval_qtys:
    | { style_ref_no: string | null; combo: string | null; qty: number; approval_qty: number }[]
    | null;
  combos: { style_ref_no: string | null; combo: string | null }[] | null;
  quantities:
    | {
        style_ref_no: string | null;
        /** The destination (0398), for the country-wise basis. Declared here as
         *  well as selected in ASSORT_WEIGHT_SELECT — a shape that names the
         *  column and a select that does not is the failure mode AGENTS.md
         *  records twice over, and it reads as working. */
        country_id: string | null;
        assortment_type_id: string | null;
        assortment_type: { code: string | null; name: string | null } | null;
        assort_lines:
          | {
              combo: string | null;
              no_of_cartons: number | null;
              inners_per_carton: number | null;
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
 * `sizeNames` is supplied by the caller that has the lookups; without it a slice
 * is labelled with its uuid, which is legible to nobody.
 *
 * A PLAIN MAP, NEVER A RESOLVER FUNCTION. The result of this crosses a server
 * action boundary (`loadOrderProduction`), and React cannot serialize a
 * function — see the note on `OrderProductionInput.sizeNames`.
 */
export function orderProductionInput(
  row: OrderRow,
  tiersById: Map<string, RejectionTier[]>,
  sizeNames?: Readonly<Record<string, string>>,
  countryNames?: Readonly<Record<string, string>>,
): OrderProductionInput {
  const assortSizes = assortSizeWeights(row.quantities);

  return {
    excessPct: Number(row.excess_pct) || 0,
    rejectionPct: Number(row.rejection_pct) || 0,
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
    sizeNames,
    countryNames,
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

/**
 * Destination names, keyed by id — for the country-wise basis's row labels.
 *
 * A MAP, never a resolver, for the reason `OrderProductionInput.sizeNames`
 * records at length: this object crosses a server action boundary and a function
 * cannot be serialized across it.
 *
 * `blocked` rows are SELECTED rather than filtered, the same call
 * `rejectionTiersById` makes above: a country switched off after an order shipped
 * to it must still resolve to its NAME, or an existing BOM's rows start labelling
 * themselves with a uuid.
 */
export async function countryNamesById(): Promise<Record<string, string>> {
  const s = await createClient();
  const { data } = await s.from("countries").select("id, name");
  return Object.fromEntries((data ?? []).map((r) => [r.id as string, r.name as string]));
}

export async function sizeNamesById(): Promise<Record<string, string>> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, name")
    .eq("kind", "size");
  return Object.fromEntries(
    (data ?? []).map((r) => [r.id as string, r.name as string]),
  );
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
  const [tiers, sizeNames, countryNames, res] = await Promise.all([
    rejectionTiersById(),
    sizeNamesById(),
    countryNamesById(),
    s.from("garment_order_amendments").select(ORDER_SELECT).eq("id", garmentOrderId).maybeSingle(),
  ]);
  if (!res.data) return null;
  return orderProductionInput(res.data as unknown as OrderRow, tiers, sizeNames, countryNames);
}

// ---------------------------------------------------------------------------
// The work queue, shared by both BOM steps
// ---------------------------------------------------------------------------

/**
 * One row of a BOM work queue.
 *
 * IT IS AN ORDER, NOT A DOCUMENT, and that is the whole point of the shape.
 * Listing BOM documents makes an order with no BOM invisible — precisely the
 * order that needs one — so "Pending" could never be shown for the case it
 * exists to describe.
 */
export type BomTaskRow = {
  /** The garment order id — the row's identity. */
  id: string;
  sc_no: string | null;
  order_code: string | null;
  po_no: string | null;
  customer_name: string | null;
  amend_date: string;
  delivery_date: string | null;
  style_count: number;
  /** Total production the order currently implies. Null when unanswerable. */
  production_qty: number | null;
  /** Why it is unanswerable, when it is — printed rather than left as a dash. */
  production_refusal: string | null;
  status: BomStatus;
  /** The BOM to open, or null to start one. */
  bom_id: string | null;
  bom_code: string | null;
  bom_line_count: number;
  created_at: string;
  created_by: string | null;
};

/** As much of a BOM document as a queue row needs, whichever BOM it is. */
export type BomLite = {
  id: string;
  code: string | null;
  is_draft: boolean;
  computed_basis_hash: string | null;
  computed_for_qty: number | null;
  lineCount: number;
};

export type OrderWithProvenance = OrderRow & {
  created_at: string;
  created_by: string | null;
};

/**
 * Turn confirmed orders plus their BOMs into queue rows.
 *
 * SHARED BY MATERIAL BOM AND FABRIC BOM, and it is the freshness half that
 * earns the sharing rather than the field copying. `basisFingerprint` must be
 * computed from the SAME `OrderProductionInput` that `totalProductionOf`
 * refused or answered, and the refusal must null BOTH — a queue that
 * fingerprinted an order it could not total would report "Updated" over a plan
 * whose basis it never resolved. Two copies of that pairing is two chances to
 * get it the wrong way round.
 *
 * Each caller still runs its own query: the BOM table and its line child differ,
 * and a PostgREST select string is not something to build by concatenation.
 */
export function bomTaskRows(
  orders: readonly OrderWithProvenance[],
  tiers: Map<string, RejectionTier[]>,
  bomByOrder: Map<string, BomLite>,
): BomTaskRow[] {
  const rows: BomTaskRow[] = orders.map((o) => {
    const input = orderProductionInput(o, tiers);
    const total = totalProductionOf(input);
    const bom = bomByOrder.get(o.id) ?? null;

    const now = {
      // A refused total means the order cannot be fingerprinted into anything
      // comparable, so freshness is `unresolved` rather than a guess.
      hash: isRefusal(total) ? null : basisFingerprint(input),
      qty: isRefusal(total) ? null : total,
    };

    return {
      id: o.id,
      sc_no: o.sales_order?.order_number ?? null,
      order_code: o.code,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      amend_date: o.amend_date,
      delivery_date: o.delivery_date,
      style_count: (o.styles ?? []).length,
      production_qty: now.qty,
      production_refusal: isRefusal(total) ? total.refused : null,
      status: bomStatusOf(
        bom
          ? {
              is_draft: bom.is_draft,
              lineCount: bom.lineCount,
              computed_basis_hash: bom.computed_basis_hash,
              computed_for_qty: bom.computed_for_qty,
            }
          : null,
        now,
      ),
      bom_id: bom?.id ?? null,
      bom_code: bom?.code ?? null,
      bom_line_count: bom?.lineCount ?? 0,
      // The ORDER's provenance, not the BOM's: the row is an order, and an order
      // with no BOM still has a creator worth showing.
      created_at: o.created_at,
      created_by: o.created_by,
    };
  });

  // Work first: Recalculate, Pending, Draft, Unresolved, then Updated.
  rows.sort(
    (a, b) =>
      BOM_STATUS_RANK[a.status] - BOM_STATUS_RANK[b.status] ||
      (a.delivery_date ?? "9999").localeCompare(b.delivery_date ?? "9999"),
  );
  return rows;
}

/**
 * Confirmed garment orders, with the provenance a queue row shows.
 *
 * CONFIRMED ONLY (client 2026-08-13: "lists all confirmed RE Numbers"). A draft
 * order is someone's half-entered thinking — its styles, combos and quantities
 * are all still moving, so a plan built against it is planned against numbers
 * that have not settled.
 *
 * It is the ORDER's draft flag, not the BOM's. A queue's own `draft` status
 * means "a BOM exists and is unfinished", which is a different sentence.
 */
export async function confirmedOrdersForBom(): Promise<OrderWithProvenance[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_order_amendments")
    .select(ORDER_SELECT)
    .eq("is_draft", false)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as OrderWithProvenance[];
}
