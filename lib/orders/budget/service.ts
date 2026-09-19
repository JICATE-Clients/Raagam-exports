import "server-only";
import {
  ASSORT_WEIGHT_SELECT,
  assortSizeWeights,
  type AssortQuantity,
} from "@/lib/orders/assort-weights";
import { createClient } from "@/lib/supabase/server";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { HOME_CURRENCY, orderValue } from "@/lib/orders/amendments/order-value";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { orderUnitLabel } from "@/lib/orders/amendments/types";
import {
  asFabricSource,
  sourceBuysCloth,
  type FabricSource,
} from "@/lib/orders/fabric-bom/fabric-source";
import {
  isReportRefusal,
  qtyBreakdownOf,
  yarnFabricRequirementReport,
  type YarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/reports";
import { stageRank } from "@/lib/orders/fabric-bom/stage-routes";
import { shadeDyeingCharges } from "@/lib/orders/fabric-bom/stage-ledger";
import {
  orderProductionInput,
  rejectionTiersById,
  type OrderRow as BasisOrderRow,
} from "@/lib/orders/bom-order-basis";
import { orderSalesValue } from "./totals";
import { budgetFigures, type BudgetFigures } from "./figures";
import type { BudgetSource, FabricProcessRow } from "./totals";
import type {
  BudgetApprovalRow,
  BudgetableOrder,
  BudgetableStyle,
  BudgetLineBasis,
  BudgetRateType,
  BudgetStatus,
  OrderBudget,
} from "./types";

export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };

// ---------------------------------------------------------------------------
// What an order will sell for
// ---------------------------------------------------------------------------

/**
 * Every confirmed order's value, in one pass.
 *
 * ## IT USES `orderValue()`, THE GARMENT ORDER SCREEN'S OWN FUNCTION
 *
 * Not a re-derivation. The screen shows a figure at the bottom of the Prices tab
 * and the budget must agree with it, or the operator is asked to reconcile two
 * numbers for one order — which is the drift AGENTS.md records under Nominated
 * vendors and 0413 records for the projection maths. `orderValue` also carries
 * the rules that are easy to get wrong: a style priced twice is UNRESOLVED
 * rather than averaged, a style with quantity and no price poisons the order's
 * whole value, and a size-wise price is weighted by the assortment.
 *
 * ## EVERY VALUE IS CONVERTED TO INR BEFORE IT LEAVES THIS FUNCTION
 *
 * `orderValue` answers in the BUYER'S OWN CURRENCY - a USD order returns dollars
 * and an INR order returns rupees, with nothing in the number saying which. This
 * used to be handed straight out as `sales_value`, and a budget grouping a USD
 * order with an INR one ADDED THE TWO TOGETHER UNCONVERTED. The total looked
 * entirely ordinary; it was the sum of two different units, and it is the figure
 * a profit margin is calculated from.
 *
 * `inrValue` is imported rather than reimplemented, for its refusals as much as
 * its arithmetic:
 *
 *   - an order already in INR converts at 1 - checked on the currency the order
 *     NAMES, and a blank currency is not assumed to be home;
 *   - `ex_rate` is `numeric(14,4) NOT NULL DEFAULT 0`, so an unfilled rate reads
 *     as ZERO, and zero times a real gross value is "this order is worth
 *     nothing" rather than "unknown". It returns null, and the null travels into
 *     `sales_refusal` where the operator can read it.
 *
 * ## THE BUDGET'S OWN `exchange_rate` DOES NOT REACH THIS FUNCTION, AND CANNOT
 *
 * `order_budgets.exchange_rate` is a planning rate on the budget header, and the
 * argument for letting it override the order's booking rate is a good one. It is
 * not wired here and the reason is structural, not an oversight: this function
 * feeds `listBudgetableOrders()`, the menu of orders a budget COULD pick up -
 * there is no budget in scope yet. Its output is then SNAPSHOTTED into
 * `order_budget_orders.sales_value`, a column with no currency and no rate
 * beside it, so a later re-conversion at the budget's rate has nothing to
 * re-convert FROM and no way to tell an already-converted figure from a raw one.
 *
 * Making the budget's rate govern therefore needs `currency_code` and `ex_rate`
 * carried onto `order_budget_orders` - a migration, and a decision about what
 * happens to a budget already approved at the old rate. Left deliberately
 * undone rather than half-done: a second rate applied to an already-converted
 * figure is a silent double conversion, which is a worse bug than the one this
 * fixes.
 *
 * ## A SEPARATE QUERY, NOT AN EMBED ON `ORDER_SELECT`
 *
 * `bom-order-basis.ts`'s select already names four child relationships and is
 * read by three screens; PostgREST fails the WHOLE query when one name stops
 * resolving, so growing it to add prices would put both BOM screens at risk to
 * value a budget. The same call `listMaterialBomStatus` records making.
 *
 * ## IT ALSO HANDS BACK THE FACTS IT VALUED FROM (0572)
 *
 * The SQ header and the Sales bar need the order's quantity, its currency and
 * rate, and the gross in the buyer's currency. Every one of them is already in
 * hand here, so they ride out beside the INR value rather than being fetched
 * or recomputed a second time — two reads of one order's value is two chances
 * to disagree with the Prices tab.
 */
type SalesFacts = {
  value: number | null;
  refusal: string | null;
  gross_value: number | null;
  qty: number | null;
  currency_code: string | null;
  ex_rate: number | null;
};

async function salesValuesByOrder(): Promise<
  { ok: true; byOrder: Map<string, SalesFacts> } | { ok: false; error: string }
> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_order_amendments")
    .select(
      "id, ex_rate, currency_code, " +
        "styles:garment_order_amendment_styles(style_ref_no, po_qty), " +
        "prices:garment_order_amendment_price_details(style_ref_no, price_type, combo, size_id, price), " +
        `quantities:garment_order_amendment_quantities(${ASSORT_WEIGHT_SELECT})`,
    )
    .eq("is_draft", false);

  type Row = {
    id: string;
    ex_rate: number | null;
    currency_code: string | null;
    styles: { style_ref_no: string | null; po_qty: number | null }[] | null;
    prices:
      | {
          style_ref_no: string | null;
          price_type: string | null;
          combo: string | null;
          size_id: string | null;
          price: number | null;
        }[]
      | null;
    quantities: AssortQuantity[] | null;
  };

  /* A FAILED QUERY IS AN ERROR, NOT AN EMPTY MAP. Empty, every order would
     read "this order could not be read" — true, but it hides the one sentence
     that says why. */
  if (error) return { ok: false, error: error.message };

  const out = new Map<string, SalesFacts>();
  for (const r of (data ?? []) as unknown as Row[]) {
    /* ONE RULE, NOT A THIRD COPY (2026-08-20).
       This was `no_of_cartons x that size's pieces`, described as "copied
       deliberately" so the three readers of the assort tree could not disagree.
       They disagreed anyway: on a SOLID/SOLID pack there is no carton count, so
       this multiplied every size by zero and valued the whole order at nothing —
       silently, because a zero looks exactly like an order nobody has filled in.
       It also dropped `inners_per_carton`, under-counting any assort pack.
       See `assortSizeWeights`. */
    const weights = assortSizeWeights(r.quantities);

    const v = orderValue(
      (r.styles ?? []).map((x) => ({
        style_ref_no: x.style_ref_no,
        po_qty: Number(x.po_qty) || 0,
      })),
      (r.prices ?? []).map((x) => ({
        style_ref_no: x.style_ref_no,
        price_type: x.price_type,
        combo: x.combo,
        size_id: x.size_id,
        price: Number(x.price) || 0,
      })),
      weights,
    );

    /* IN INR, ALWAYS - see the header. The value and the ORDER OF ITS REFUSALS
       are `orderSalesValue`'s, in `./totals`, because this module is
       `server-only` and nothing in it can be reached by a vector. */
    /* THE QUANTITY `orderValue` COUNTS, summed the way it sums it — a line
       with a style key and a positive `po_qty`. Not read back off `avgRate`,
       which is rounded to six places and would hand back 6999.99 garments. */
    const qty = (r.styles ?? []).reduce((a, x) => {
      const q = Number(x.po_qty) || 0;
      return styleKey(x.style_ref_no) && q > 0 ? a + q : a;
    }, 0);

    /* THE RATE `inrValue` ACTUALLY APPLIES. An INR order converts at 1
       whatever the column says; any other order's 0 is "not entered" (the
       column's default), so it goes out as null rather than as a rate. */
    const currency = r.currency_code?.trim() ? r.currency_code.trim().toUpperCase() : null;
    const storedRate = Number(r.ex_rate) || 0;
    const exRate = currency === HOME_CURRENCY ? 1 : storedRate > 0 ? storedRate : null;

    out.set(r.id, {
      ...orderSalesValue({
        grossValue: v.grossValue,
        unresolved: v.unresolved,
        exRate: storedRate,
        currencyCode: r.currency_code,
      }),
      gross_value: v.grossValue,
      qty: qty > 0 ? qty : null,
      currency_code: currency,
      ex_rate: exRate,
    });
  }
  return { ok: true, byOrder: out };
}

// ---------------------------------------------------------------------------
// What each order MAKES — per style, the legacy "SQ Qty" (0574)
// ---------------------------------------------------------------------------

type OrderStyleFacts = {
  is_set_pack: boolean;
  styles: BudgetableStyle[];
  /** Σ of the styles' SQ Qty; null + reason the moment one refuses. */
  sq_qty: number | null;
  sq_refusal: string | null;
  /** The word the order's quantity is counted in — see `orderUnitOf`. */
  unit: string | null;
};

/**
 * Per order, per style: what was ordered, what will be MADE, and which
 * coordinates it is made of.
 *
 * ## SQ QTY IS THE FABRIC BOM REPORT'S OWN "Cut Qty", CALLED PER STYLE
 *
 * The legacy "SQ Qty" is Order + Excess + Rejection + Approval — the Fabric BOM
 * report's `sqQty`, with the TIERED rejection projection and its refusal when
 * the chosen rule has a gap. It is read by calling `qtyBreakdownOf` (reports.ts)
 * over one style's approval rows, never re-derived: three budget tabs (the
 * header, CMTs, Garment Processes) read "pieces made", and one arithmetic is
 * what keeps them — and the report — saying one number. The blueprint's own
 * figures prove the split from the order quantity: its Gross Sales is 5028
 * (Order Qty) x 9.20 x 84, while its CMT runs on 5321.
 *
 * ## ONE QUERY FOR EVERY ORDER, NOT `getOrderProduction` PER ORDER
 *
 * This feeds `listBudgetableOrders`, which lists every confirmed order; a
 * per-order fetch would be four round trips per order on every budget open.
 * `orderProductionInput` — the shaping `getOrderProduction` itself uses — is
 * called on each row, so the tiers, the excess and the "rule chosen" flag are
 * read exactly as the BOMs read them. The select names only what that shaping
 * reads plus the style lines and their coordinates; the assortment tree it
 * would also flatten is not needed for SQ Qty and is left out (`quantities:
 * null`), which `assortSizeWeights` answers as no assortment.
 */
async function styleFactsByOrder(
  orderIds?: readonly string[],
): Promise<Map<string, OrderStyleFacts>> {
  const s = await createClient();
  const q = s
    .from("garment_order_amendments")
    .select(
      "id, excess_pct, rejection_rule_id, rejection_pct, is_set_pack, " +
        "styles:garment_order_amendment_styles(style_ref_no, style_description, article_no, po_qty, unit_kind), " +
        "approval_qtys:garment_order_amendment_approval_qtys(style_ref_no, combo, qty, approval_qty), " +
        /* One FK from the coordinates to `items` (0461), so the column naming
           is belt-and-braces rather than a disambiguation. */
        "coordinates:garment_order_amendment_style_coordinates(style_ref_no, sno, coordinate:items!coordinate_id(id, name))",
    );
  const [tiers, res] = await Promise.all([
    rejectionTiersById(),
    orderIds ? q.in("id", [...orderIds]) : q.eq("is_draft", false),
  ]);
  // Thrown: an empty map would read as "no order has any style", and every
  // SQ Qty on the screen would refuse for a reason that is not the real one.
  if (res.error) throw new Error(`Could not read the orders' styles: ${res.error.message}`);

  type Row = {
    id: string;
    excess_pct: number | null;
    rejection_rule_id: string | null;
    rejection_pct: number | null;
    is_set_pack: boolean | null;
    styles:
      | {
          style_ref_no: string | null;
          style_description: string | null;
          article_no: string | null;
          po_qty: number | null;
          unit_kind: string | null;
        }[]
      | null;
    approval_qtys:
      | { style_ref_no: string | null; combo: string | null; qty: number; approval_qty: number }[]
      | null;
    coordinates:
      | { style_ref_no: string | null; sno: number; coordinate: { id: string; name: string } | null }[]
      | null;
  };

  const out = new Map<string, OrderStyleFacts>();
  for (const r of (res.data ?? []) as unknown as Row[]) {
    const production = orderProductionInput(
      {
        ...r,
        combos: null,
        quantities: null,
      } as unknown as BasisOrderRow,
      tiers,
    );

    const styles = new Map<string, BudgetableStyle>();
    for (const line of r.styles ?? []) {
      const key = styleKey(line.style_ref_no);
      if (!key) continue; // a blank line the operator never filled
      const held = styles.get(key);
      if (held) {
        // DUPLICATE REFS ARE SUMMED — two lines of one style are one style's order.
        held.order_qty += Number(line.po_qty) || 0;
        held.style_description ??= line.style_description;
        held.article_no ??= line.article_no;
        held.unit_kind ??= line.unit_kind;
        continue;
      }
      styles.set(key, {
        style_ref_no: key,
        style_description: line.style_description,
        article_no: line.article_no,
        unit_kind: line.unit_kind,
        order_qty: Number(line.po_qty) || 0,
        sq_qty: null,
        sq_refusal: null,
        coordinates: [],
      });
    }

    for (const c of [...(r.coordinates ?? [])].sort((a, b) => a.sno - b.sno)) {
      const st = styles.get(styleKey(c.style_ref_no));
      if (!st || !c.coordinate) continue;
      if (!st.coordinates.some((x) => x.id === c.coordinate!.id)) {
        st.coordinates.push({ id: c.coordinate.id, name: c.coordinate.name });
      }
    }

    let sq: number | null = 0;
    let sqRefusal: string | null = null;
    for (const st of styles.values()) {
      const b = qtyBreakdownOf({
        ...production,
        approvals: production.approvals.filter((a) => styleKey(a.style_ref_no) === st.style_ref_no),
      });
      if (isReportRefusal(b)) {
        st.sq_refusal = b.refused;
        if (sqRefusal == null) sqRefusal = `${st.style_ref_no}: ${b.refused}`;
        sq = null;
      } else {
        st.sq_qty = b.sqQty;
        if (sq != null) sq += b.sqQty;
      }
    }
    if (styles.size === 0) {
      sq = null;
      sqRefusal = "no style lines on the order";
    }

    const isSetPack = r.is_set_pack === true;
    out.set(r.id, {
      is_set_pack: isSetPack,
      styles: [...styles.values()],
      sq_qty: sqRefusal ? null : sq,
      sq_refusal: sqRefusal,
      unit: orderUnitOf(isSetPack, [...styles.values()]),
    });
  }
  return out;
}

/**
 * The word an order's quantity is counted in.
 *
 * NOT ALWAYS PCS — Phase 1 said it was, and that was wrong for one case. On a
 * retail SET PACK (0467) `po_qty` is exploded to pieces at entry, so the
 * order's quantity IS pieces. But on an ordinary order a `unit_kind = 'set'`
 * style's `po_qty` counts SETS: the live W63076/RE/44 is 3500 with TOP and
 * BOTTOM coordinates and 3500 approval pieces per coordinate, and the Fabric
 * BOM costs each coordinate's panels on that same 3500. So the word is the
 * styles' own Order Unit when they agree, and nothing — never a guess — when
 * they disagree or were never answered (0471: NULL is "not answered").
 */
function orderUnitOf(isSetPack: boolean, styles: readonly BudgetableStyle[]): string | null {
  if (isSetPack) return orderUnitLabel("piece");
  const kinds = new Set(styles.filter((st) => st.order_qty > 0).map((st) => st.unit_kind));
  if (kinds.size !== 1) return null;
  return orderUnitLabel([...kinds][0]) || null;
}

// ---------------------------------------------------------------------------
// The orders a budget can pick up
// ---------------------------------------------------------------------------

export async function listBudgetableOrders(): Promise<BudgetableOrder[]> {
  const s = await createClient();

  const [values, styleFacts, ordersRes, coveredRes, fabricRes, materialRes, combosRes] = await Promise.all([
    salesValuesByOrder(),
    styleFactsByOrder(),
    s
      .from("garment_order_amendments")
      .select(
        "id, code, po_no, delivery_date, customer:customers(name), " +
          "sales_order:sales_orders(order_number), " +
          /* The FK column is NAMED, the way `fabric-bom/reports.ts` reads the
             same pair — a second FK to `sq_details` would otherwise turn this
             whole list into a 300 (AGENTS.md). */
          "sq_detail:sq_details!sq_detail_id(code, sq_description)",
      )
      .eq("is_draft", false)
      .order("created_at", { ascending: false }),
    s
      .from("order_budget_orders")
      .select("garment_order_id, budget:order_budgets(id, code, status)"),
    s.from("order_fabric_bom_requirements").select("item_id, bom:order_fabric_boms(garment_order_id)"),
    s
      .from("material_bom_amendment_requirements")
      .select("item_id, bom:material_bom_amendments(garment_order_id)"),
    /* EACH ORDER'S COLOURWAYS (0590) — Yarn Purchases' Colour dropdown, the
       same list the Fabric BOM's Yarn Process offers. `amendment_id` IS the
       garment order. */
    s.from("garment_order_amendment_combos").select("amendment_id, combo").order("sno"),
  ]);

  /* THE ORDER LIST ITSELF IS NOT ALLOWED TO FAIL QUIETLY. `?? []` here would
     render "no orders to budget" — a real and unremarkable answer — over a
     query that did not run. Thrown, so the route's error boundary says so. */
  if (ordersRes.error) throw new Error(`Could not read the garment orders: ${ordersRes.error.message}`);
  // Nor the colourways: an empty Colour list would read as "this order has none".
  if (combosRes.error) throw new Error(`Could not read the orders' colourways: ${combosRes.error.message}`);
  const combosOf = new Map<string, string[]>();
  for (const c of (combosRes.data ?? []) as { amendment_id: string; combo: string | null }[]) {
    const name = (c.combo ?? "").trim();
    if (!name) continue;
    const list = combosOf.get(c.amendment_id) ?? [];
    if (!list.includes(name)) list.push(name);
    combosOf.set(c.amendment_id, list);
  }

  type Covered = {
    garment_order_id: string;
    budget: { id: string; code: string | null; status: BudgetStatus } | null;
  };
  const covered = new Map<string, { id: string; code: string | null; status: BudgetStatus }>();
  for (const c of (coveredRes.data ?? []) as unknown as Covered[]) {
    if (!c.budget) continue;
    const held = covered.get(c.garment_order_id);
    // AN APPROVED BUDGET WINS THE MENTION. An order sitting in three drafts and
    // one approved budget needs to report the approved one — that is the state
    // that will refuse a second approval.
    if (!held || (held.status !== "approved" && c.budget.status === "approved")) {
      covered.set(c.garment_order_id, c.budget);
    }
  }

  const countBy = (
    rows: unknown[],
    key: (r: never) => string | null | undefined,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const id = key(r as never);
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  };

  const fabricCounts = countBy(
    fabricRes.data ?? [],
    (r: { bom: { garment_order_id: string } | null }) => r.bom?.garment_order_id,
  );
  const materialCounts = countBy(
    materialRes.data ?? [],
    (r: { bom: { garment_order_id: string | null } | null }) => r.bom?.garment_order_id,
  );

  type OrderRow = {
    id: string;
    code: string | null;
    po_no: string | null;
    delivery_date: string | null;
    customer: { name: string } | null;
    sales_order: { order_number: string | null } | null;
    sq_detail: { code: string | null; sq_description: string | null } | null;
  };

  const unread = (refusal: string): SalesFacts => ({
    value: null,
    refusal,
    gross_value: null,
    qty: null,
    currency_code: null,
    ex_rate: null,
  });

  return ((ordersRes.data ?? []) as unknown as OrderRow[]).map((o) => {
    const v = values.ok
      ? (values.byOrder.get(o.id) ?? unread("this order could not be read"))
      : unread(`the order's prices could not be read — ${values.error}`);
    const sf = styleFacts.get(o.id);
    return {
      id: o.id,
      combos: combosOf.get(o.id) ?? [],
      sc_no: o.sales_order?.order_number ?? null,
      order_code: o.code,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      delivery_date: o.delivery_date,
      sq_no: o.sq_detail?.code ?? null,
      sq_description: o.sq_detail?.sq_description ?? null,
      re_no: o.sales_order?.order_number ?? null,
      qty: v.qty,
      /* THE STYLES' OWN ORDER UNIT, not "PCS always" — see `orderUnitOf`: a
         `set` style of an ordinary order counts SETS. */
      unit: v.qty == null ? null : (sf?.unit ?? null),
      currency_code: v.currency_code,
      ex_rate: v.ex_rate,
      gross_value: v.gross_value,
      sales_value: v.value,
      sales_refusal: v.refusal,
      sq_qty: sf?.sq_qty ?? null,
      sq_refusal: sf ? sf.sq_refusal : "this order's styles could not be read",
      styles: sf?.styles ?? [],
      in_budget: covered.get(o.id) ?? null,
      fabric_cost_lines: fabricCounts.get(o.id) ?? 0,
      material_cost_lines: materialCounts.get(o.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Cost lines pulled from the two BOMs
// ---------------------------------------------------------------------------

export type PulledCostLine = {
  source: BudgetSource;
  garment_order_id: string;
  item_id: string | null;
  description: string;
  qty: number;
  uom_id: string | null;
  rate: number | null;
  /** Always null when pulled — the BOMs hold no brand text; typed on the budget. */
  specification: string | null;
  /** Always null when pulled (= INR). No BOM stores a quoted currency. */
  currency_code: string | null;
  ex_rate: number | null;
  /** From `material_bom_amendment_items.is_foc` (0474); false off the Fabric BOM. */
  is_foc: boolean;
  /** The Material BOM item's supply type is Import (any case); false otherwise. */
  is_import: boolean;
  /** The process a `*_process` line charges for (0573); null on purchases. */
  process_id: string | null;
  /** The grain a process line was split at (0573); null on purchases. */
  basis: BudgetLineBasis | null;
  /** The colourway the line is scoped to, where the BOM scoped it. */
  combo: string | null;
  /** Always `per_unit` when pulled — a flat charge is the operator's call. */
  rate_type: BudgetRateType;
  /** Garment Processes multipliers — 1 on a pulled garment line, null (= 1)
   *  everywhere else. */
  no_of_pcs: number | null;
  no_of_units: number | null;
  /** Garment lines only: the style, and (Partwise) the component. What keeps
   *  one process on two styles — or two components — two lines. */
  style_ref_no: string | null;
  component_id: string | null;
  /** CMT breakup (0574) — always null when pulled; the planner breaks it up. */
  cutting_rate: number | null;
  making_rate: number | null;
  checking_rate: number | null;
  ironing_rate: number | null;
  packing_rate: number | null;
  /** Expense / Income Head (0575) — always null: nothing pulled is an
   *  "other" line. Carried so a pulled line spreads into a saved one whole. */
  cost_head_id: string | null;
  /** The yarn stage (0590) — set on a `yarn` line from its Fabric BOM Yarn
   *  Process (see the yarn branch), NULL on every other source. */
  stage_id: string | null;
};

/** The 0572 / 0573 facts every pulled line starts from. `satisfies` rather
 *  than `as const`, so `rate_type` stays the union and a spread line can
 *  override any of them. */
const PULLED_DEFAULTS = {
  specification: null,
  currency_code: null,
  ex_rate: null,
  is_foc: false,
  is_import: false,
  process_id: null,
  basis: null,
  combo: null,
  rate_type: "per_unit",
  no_of_pcs: null,
  no_of_units: null,
  style_ref_no: null,
  component_id: null,
  cutting_rate: null,
  making_rate: null,
  checking_rate: null,
  ironing_rate: null,
  packing_rate: null,
  cost_head_id: null,
  stage_id: null,
} satisfies Omit<
  PulledCostLine,
  "source" | "garment_order_id" | "item_id" | "description" | "qty" | "uom_id" | "rate"
>;

/**
 * The Fabric and Material BOM requirements for a set of orders, as budget lines.
 *
 * ## IT PULLS THE STORED REQUIREMENT AND NEVER RE-DERIVES IT
 *
 * Both BOMs store their figures precisely so a downstream document has a number
 * that cannot move under it (0418 · 0426). Recomputing here would be a third
 * copy of the excess and projection maths.
 *
 * ## A REFUSED REQUIREMENT IS SKIPPED, AND THE CALLER IS TOLD HOW MANY
 *
 * `required_qty` NULL is a question the operator has not answered, not a
 * quantity of zero. Pulling it as 0 would put a costless line in a budget that
 * gets approved; dropping it silently would make the budget look complete. So it
 * is dropped AND counted.
 *
 * ## RATE COMES FROM THE BOM LINE WHERE THERE IS ONE
 *
 * The Fabric BOM carries a `rate` per line; the Material BOM carries an
 * `estimated_rate` per line since 0588 (the merchandiser's figure for an item
 * not yet confirmed, or any line). A missing rate arrives as null and the operator types it — it is NOT defaulted to a
 * last-purchase price, because a budget that quietly priced itself from history
 * is a budget nobody checked.
 *
 * ## A FABRIC IS A PURCHASE LINE ONLY WHEN THE FABRIC IS BOUGHT (0564 · 0572)
 *
 * This used to pull EVERY Fabric BOM requirement as a `fabric` line. Under
 * Default Rule 1 (`yarn_knit`) the factory knits that cloth from yarn it buys,
 * and the yarn is already here as a `yarn` line (plus its `yarn_process`
 * lines) — so every knitted fabric was costed TWICE, once as yarn and once as
 * the cloth made from it. Nothing on screen looked wrong: two plausible lines,
 * a cost total too high by the whole fabric bill.
 *
 * So a requirement becomes a `fabric` line only when its fabric's source on
 * `order_fabric_bom_process_scope` is `greige_purchase` or `dyed_purchase`. A
 * fabric with no scope row is Rule 1 (0564: "absence means yarn_knit"), read
 * through `asFabricSource` so the two cannot disagree.
 *
 * ## AND ITS QUANTITY IS THE ROLL WEIGHT, NOT THE CUTTING-FLOOR NET
 *
 * `required_qty` is what the cutting floor consumes. A greige roll loses weight
 * in dyeing, compacting and whatever else the route declares after it lands,
 * so buying `required_qty` of greige under-buys by every one of those losses.
 * The weight to buy is the net grossed by the fabric's SUPPRESSED ladder — the
 * "Greige / Dyed Fabric Roll Weight" of the Yarn & Fabric Requirement Report.
 *
 * NOTHING STORES THAT FIGURE; the report computes it at print time. So this
 * reads it FROM the report (`yarnFabricRequirementReport(...).clothPurchase`),
 * one line per (fabric, colourway, panel) exactly as the report prints it,
 * rather than re-deriving the ladder a second time here. The budget and the
 * sheet the purchaser is handed then cannot disagree. A report that refuses,
 * or a fabric whose weight it could not place, is SKIPPED AND COUNTED — never
 * pulled at the net, which would be an under-buy wearing a real number.
 *
 * ## FOC AND IMPORT RIDE IN FROM THE MATERIAL BOM LINE (0572)
 *
 * Through the requirement's own `item_line_id`, not by (bom, item) — one
 * material sits on several lines of a BOM, and only some of them may be free.
 *
 * ## A FAILED READ THROWS
 *
 * Every read here used to be `data ?? []`, so a query that did not run pulled
 * nothing and the screen said "no recorded BOM yet". `loadCostLines` catches
 * the throw and shows the real sentence.
 *
 * ## THE PROCESS RATES SOURCES (0573)
 *
 * - `yarn_process` — unchanged in grain; gains `process_id`, the stage's name
 *   and `basis = 'process'`.
 * - `fabric_process` — one line per (process, fabric), from the SAME report
 *   call the cloth purchase above reads (one per BOM, never two). Its weight is
 *   the stage ledger's `toOrderedWt`: the cloth SENT INTO the step, which is
 *   what a job worker weighs and invoices — see `fabricBomLines`.
 * - `material_process` — one line per Material BOM process row, weighed by
 *   that item's own stored requirement on that BOM.
 * - `garment_process` — one line per Style ▸ Process row, weighed by the
 *   style's SQ Qty (`styleFactsByOrder`), with No of Pcs and No of Units at 1.
 *
 * ## CMT (0574) — one line per (order, style, coordinate)
 *
 * Weighed by the style's SQ Qty, the SAME figure Garment Processes reads: CMT
 * and a garment process are both labour on the same garments, and within one
 * budget "pieces made" is one number. The coordinate goes in `item_id` — a CMT
 * line costs MAKING that garment item, as a yarn line's `item_id` is the yarn
 * bought — and a style with no coordinates is one line with none.
 *
 * EACH COORDINATE GETS THE WHOLE STYLE QTY, because on an ordinary order a
 * `set` style's `po_qty` counts SETS (verified live: W63076/RE/44, 3500 with
 * TOP and BOTTOM, costed by the Fabric BOM on 3500 per coordinate) — 3500 sets
 * is 3500 tops and 3500 bottoms to make.
 *
 * A RETAIL SET PACK (0467) IS THE EXCEPTION: there `po_qty` is exploded to
 * PIECES at entry, across the pack's members, so splitting it again per
 * coordinate would count each piece once per coordinate. Such a style is one
 * line for its whole piece count. (No set-pack order exists live today.)
 */
export async function pullCostLines(
  garmentOrderIds: readonly string[],
): Promise<{ lines: PulledCostLine[]; skipped: number }> {
  if (garmentOrderIds.length === 0) return { lines: [], skipped: 0 };
  const s = await createClient();

  const [fabricRes, yarnRes, yarnStageRes, materialRes, materialProcRes, garmentProcRes] =
    await Promise.all([
    s
      .from("order_fabric_bom_requirements")
      .select(
        "item_id, required_qty, consumption_uom_id, slice_label, " +
          "line:order_fabric_bom_lines(rate), " +
          "bom:order_fabric_boms(id, garment_order_id, is_draft)",
      ),
    /* THE YARN PURCHASE (0493). A third pulled source, from the Fabric BOM's
       Yarn Process tab — one row per yarn its fabrics are made of, carrying a
       weight the BOM computed. `process:processes(name)` rides along for the
       description; see the branch below on why it is only shown when set. */
    s
      .from("order_fabric_bom_yarns")
      .select(
        "item_id, purchase_qty, uom_id, refusal_reason, " +
          "bom:order_fabric_boms(garment_order_id, is_draft)",
      ),
    /* THE YARN PROCESSES (0504 · 0520 · 0529) — the tab's SECOND budget
       section. One line per step that names a process, quantified by what that
       step handles. Read from the stage rather than recomputed, for the reason
       every pulled source here is read: the quantity is a figure the Fabric BOM
       computed and re-deriving it would be a second answer.

       `combo` IS SELECTED AGAIN (0529) — a step quantified "the purple lot
       alone" is back, and the description below names it. 0520 had dropped the
       column; its own comment here warned that leaving a dropped column in a
       `.select()` string fails the WHOLE query silently (this file reads
       `yarnStageRes.data ?? []`), the failure AGENTS.md records under "A
       SECOND FK BREAKS EVERY EXISTING EMBED" — restoring the column here
       without 0529 re-adding it to the table would be exactly that trap. */
    s
      .from("order_fabric_bom_yarn_stages")
      .select(
        "sno, stage_id, process_qty, uom_id, combo, process_id, " +
          "process:processes!process_id(name), " +
          /* `stage_id` AND `loss_for_id` BOTH point at config_lookups, so the
             FK column is NAMED — a bare `config_lookups(name)` is a 300 that
             would empty this whole select (AGENTS.md). */
          "stage:config_lookups!stage_id(name, code), " +
          "yarn:order_fabric_bom_yarns(item_id, " +
          "bom:order_fabric_boms(garment_order_id, is_draft))",
      ),
    s
      .from("material_bom_amendment_requirements")
      .select(
        "item_id, required_qty, consumption_uom_id, slice_label, " +
          /* The LINE the requirement was computed for, by its own FK column
             (named, per AGENTS.md) — FOC and supply type live there. */
          "line:material_bom_amendment_items!item_line_id(is_foc, supply_type, estimated_rate), " +
          "amendment_id, bom:material_bom_amendments(garment_order_id, is_draft)",
      ),
    /* THE ACCESSORIES PROCESSES (0573) — the Material BOM's Process grid. No
       quantity or unit of its own: it is weighed below by the item's stored
       requirement. */
    s
      .from("material_bom_amendment_processes")
      .select(
        "amendment_id, item_id, process_id, description, for_scope, " +
          "process:processes!process_id(name), " +
          "bom:material_bom_amendments(garment_order_id, is_draft)",
      ),
    /* THE GARMENT PROCESSES (0573) — Style(s) ▸ Process on the order itself
       (0411). `amendment_id` IS the garment order a budget picks up. */
    s
      .from("garment_order_amendment_style_processes")
      .select(
        "amendment_id, style_ref_no, kind, process_id, component_id, " +
          "process:processes!process_id(name), " +
          "component:components!component_id(short_name)",
      )
      .in("amendment_id", [...garmentOrderIds]),
  ]);

  for (const [what, res] of [
    ["Fabric BOM requirements", fabricRes],
    ["Fabric BOM yarn purchases", yarnRes],
    ["Fabric BOM yarn processes", yarnStageRes],
    ["Material BOM requirements", materialRes],
    ["Material BOM processes", materialProcRes],
    ["garment processes", garmentProcRes],
  ] as const) {
    if (res.error) throw new Error(`Could not read the ${what}: ${res.error.message}`);
  }

  const wanted = new Set(garmentOrderIds);
  const itemIds = new Set<string>();
  let skipped = 0;

  type FabricReq = {
    item_id: string | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    slice_label: string;
    line: { rate: number | null } | null;
    bom: { id: string; garment_order_id: string; is_draft: boolean } | null;
  };
  type MaterialReq = {
    item_id: string | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    slice_label: string;
    line: { is_foc: boolean | null; supply_type: string | null; estimated_rate: number | null } | null;
    amendment_id: string;
    bom: { garment_order_id: string | null; is_draft: boolean } | null;
  };

  const lines: PulledCostLine[] = [];

  // A DRAFT BOM IS NOT PULLED. Its figures are someone's half-finished
  // thinking, and a budget built on them would be approved against numbers
  // that were never recorded.
  const fabricReqs = ((fabricRes.data ?? []) as unknown as FabricReq[]).filter(
    (r) => r.item_id && r.bom && !r.bom.is_draft && wanted.has(r.bom.garment_order_id),
  );
  const fabric = await fabricBomLines(s, fabricReqs);
  skipped += fabric.skipped;
  for (const l of fabric.lines) {
    if (l.item_id) itemIds.add(l.item_id);
    lines.push(l);
  }

  type YarnRow = {
    item_id: string | null;
    purchase_qty: number | null;
    uom_id: string | null;
    refusal_reason: string | null;
    bom: { garment_order_id: string; is_draft: boolean } | null;
  };

  /* EACH YARN'S FIRST STEP ON THE FABRIC BOM'S YARN PROCESS (0590) — what a
     yarn PURCHASE line copies its Stage and Colour from ("see the stage is
     from yarn process of fabric bom", user 2026-09-19). A step's Stage is the
     state the yarn ENTERS it in (yarn-process-grid.tsx), so the first step's
     Stage is the state the yarn is BOUGHT in: GREY before a dyeing step, DYED
     for yarn bought already dyed.

     COLOUR ONLY FOR A COLOURED STAGE. A GREY purchase is one lot for every
     colourway (the Fabric BOM's "grey yarn one lot") even when its dyeing step
     names one — that colour belongs to the dyeing, on Yarn Processes. "Is this
     stage coloured" is `stageRank`, the Fabric BOM's own test
     (`colouredStageIds`), never a comparison against the word DYED here.

     A YARN WITH NO STAGED STEP is bought GREY — the Fabric BOM's rule — so it
     takes the GREY `yarn_stage` row rather than nothing. */
  const { data: yarnStageLookups, error: yarnStageLookupErr } = await s
    .from("config_lookups")
    .select("id, code, name")
    .eq("kind", "yarn_stage");
  if (yarnStageLookupErr) {
    throw new Error(`Could not read the yarn stages: ${yarnStageLookupErr.message}`);
  }
  const greyStageId =
    ((yarnStageLookups ?? []) as { id: string; code: string | null; name: string }[]).find(
      (l) => stageRank(l) === 0,
    )?.id ?? null;
  const firstStep = new Map<string, { sno: number; stage_id: string; combo: string | null; coloured: boolean }>();
  for (const r of (yarnStageRes.data ?? []) as unknown as YarnStageRow[]) {
    const bom = r.yarn?.bom;
    if (!bom || bom.is_draft || !wanted.has(bom.garment_order_id)) continue;
    if (!r.stage_id || !r.yarn?.item_id) continue;
    const key = `${bom.garment_order_id}|${r.yarn.item_id}`;
    const held = firstStep.get(key);
    if (held && held.sno <= r.sno) continue;
    firstStep.set(key, {
      sno: r.sno,
      stage_id: r.stage_id,
      combo: r.combo?.trim() || null,
      coloured:
        (stageRank({ id: r.stage_id, code: r.stage?.code ?? null, name: r.stage?.name ?? "" }) ?? 0) >= 1,
    });
  }

  for (const r of (yarnRes.data ?? []) as unknown as YarnRow[]) {
    // A DRAFT BOM IS NOT PULLED, for the fabric branch's reason exactly.
    if (!r.bom || r.bom.is_draft || !wanted.has(r.bom.garment_order_id)) continue;
    /* A REFUSED YARN IS SKIPPED AND COUNTED, not pulled as a zero. Its
       `refusal_reason` says the weight could not be worked out — most often a
       fabric whose yarns declare no blend percentages — and a 0 in a budget
       reads as "this yarn is free", which is the one reading nobody would
       question. `skipped` is what the screen reports, so the planner is told a
       line was left out rather than discovering it missing. */
    if (r.purchase_qty == null) {
      skipped++;
      continue;
    }
    if (r.item_id) itemIds.add(r.item_id);
    lines.push({
      source: "yarn",
      garment_order_id: r.bom.garment_order_id,
      item_id: r.item_id,
      /* JUST THE YARN. The treatment is no longer squeezed into this line's
         description — it has a line of its own now (0504), which is the client's
         "Yarn Purchase AND Yarn Process sections" read properly. This one is the
         PURCHASE: what to buy, priced per kg of yarn. The item name is appended
         below, so "—" is the placeholder rather than the final text. */
      description: "—",
      qty: Number(r.purchase_qty),
      uom_id: r.uom_id,
      /* NO RATE. The Yarn Process tab stores none — it is a quantity document,
         not a priced one — so the planner types it here, exactly as the Material
         BOM branch below leaves it null. Defaulting to a last-purchase price is
         what the header refuses: "a budget that quietly priced itself from
         history is a budget nobody checked." */
      rate: null,
      ...PULLED_DEFAULTS,
      // 0590 — Stage and Colour off the yarn's first Yarn Process step (above).
      ...((): { stage_id: string | null; combo: string | null } => {
        const first = firstStep.get(`${r.bom.garment_order_id}|${r.item_id}`);
        return {
          stage_id: first?.stage_id ?? greyStageId,
          combo: first?.coloured ? first.combo : null,
        };
      })(),
    });
  }

  type YarnStageRow = {
    sno: number;
    stage_id: string | null;
    process_qty: number | null;
    uom_id: string | null;
    combo: string | null;
    process_id: string | null;
    process: { name: string } | null;
    stage: { name: string | null; code: string | null } | null;
    yarn: {
      item_id: string | null;
      bom: { garment_order_id: string; is_draft: boolean } | null;
    } | null;
  };

  for (const r of (yarnStageRes.data ?? []) as unknown as YarnStageRow[]) {
    const bom = r.yarn?.bom;
    if (!bom || bom.is_draft || !wanted.has(bom.garment_order_id)) continue;
    /* NO PROCESS, NO LINE — the client's "if a yarn has no process assigned, any
       associated yarn processing cost fields are automatically hidden or locked
       in the budget sheet", in its strongest form. `process_qty` is NULL on such
       a stage precisely so this test needs no second condition, and it is not
       counted as `skipped`: nothing was left out, because nothing was owed. */
    if (!r.process?.name) continue;
    /* THE DOUBLE-COUNT RULE (client 2026-09-19): a hand-typed step in a
       coloured stage (DYED) on a yarn whose dyeing is already charged per
       shade above is the same dyeing — not pulled a second time. */
    if (
      r.yarn?.item_id &&
      fabric.shadeDyedYarns.has(`${bom.garment_order_id}|${r.yarn.item_id}`) &&
      (stageRank({ id: "", code: null, name: r.stage?.name ?? "" }) ?? 0) >= 1
    ) {
      continue;
    }
    if (r.process_qty == null) {
      /* A step whose weight could not be worked out IS counted, because
         something WAS owed and is missing — the planner is told a line was left
         out rather than discovering it absent. */
      skipped++;
      continue;
    }
    if (r.yarn?.item_id) itemIds.add(r.yarn.item_id);
    lines.push({
      source: "yarn_process",
      garment_order_id: bom.garment_order_id,
      item_id: r.yarn?.item_id ?? null,
      /* THE COLOURWAY APPENDS AGAIN (0529) — what distinguishes two dyeing
         lines on one yarn, restored with `combo`. A step naming no colourway
         still reads as just the process name, `filter(Boolean)` dropping the
         empty second part rather than a stray " · ". */
      /* "PROCESS · STAGE · COMBO" (0573) — the stage says what state the yarn
         leaves the step in, which is what tells two steps of one process apart
         on a yarn that is dyed twice. */
      description: [r.process.name, r.stage?.name, r.combo].filter(Boolean).join(" · "),
      qty: Number(r.process_qty),
      uom_id: r.uom_id,
      /* NO RATE. The Yarn Process tab stores none — it is a quantity document,
         not a priced one — so the planner types it here. Defaulting to a
         last-purchase price is what the header refuses: "a budget that quietly
         priced itself from history is a budget nobody checked." */
      rate: null,
      ...PULLED_DEFAULTS,
      process_id: r.process_id,
      basis: "process",
      /* The colourway the step treats, when it names one — also what keeps two
         lots of one process on one yarn two lines (`pulledLineKey`). */
      combo: r.combo?.trim() || null,
    });
  }

  for (const r of (materialRes.data ?? []) as unknown as MaterialReq[]) {
    if (!r.bom || r.bom.is_draft || !r.bom.garment_order_id) continue;
    if (!wanted.has(r.bom.garment_order_id)) continue;
    if (r.required_qty == null) {
      skipped++;
      continue;
    }
    if (r.item_id) itemIds.add(r.item_id);
    lines.push({
      source: "material",
      garment_order_id: r.bom.garment_order_id,
      item_id: r.item_id,
      description: r.slice_label,
      qty: Number(r.required_qty),
      uom_id: r.consumption_uom_id,
      /* THE LINE'S ESTIMATED RATE WHERE THE MERCHANDISER GAVE ONE (0588) — the
         way a Fabric BOM line's own rate pre-fills the fabric line. It is the
         planner's figure, typed on the BOM, not a price looked up from history
         (which the header refuses). A line without one arrives unpriced, as
         before, and holds Save until it is priced. */
      rate: r.line?.estimated_rate == null ? null : Number(r.line.estimated_rate),
      ...PULLED_DEFAULTS,
      is_foc: r.line?.is_foc === true,
      /* CASE-INSENSITIVE — MBA stores "Import", and AGENTS.md records the
         supply-type enums disagreeing on case; `===` on one spelling
         compiles, runs and quietly matches nothing. */
      is_import: (r.line?.supply_type ?? "").trim().toLowerCase() === "import",
    });
  }

  /* THE ACCESSORIES PROCESSES — weighed by what the item needs on that BOM.
     The requirement rows are the ones already read above, so the process and
     the material cannot be weighed from two different versions of the BOM. */
  type ItemNeed = { qty: number; refused: boolean; uoms: Set<string> };
  const needByBomItem = new Map<string, ItemNeed>();
  for (const r of (materialRes.data ?? []) as unknown as MaterialReq[]) {
    if (!r.item_id) continue;
    const key = `${r.amendment_id}::${r.item_id}`;
    const need = needByBomItem.get(key) ?? { qty: 0, refused: false, uoms: new Set<string>() };
    if (r.required_qty == null) need.refused = true;
    else need.qty += Number(r.required_qty);
    if (r.consumption_uom_id) need.uoms.add(r.consumption_uom_id);
    needByBomItem.set(key, need);
  }

  type MaterialProcRow = {
    amendment_id: string;
    item_id: string | null;
    process_id: string | null;
    description: string | null;
    for_scope: string | null;
    process: { name: string } | null;
    bom: { garment_order_id: string | null; is_draft: boolean } | null;
  };
  /* ONE LINE PER (BOM, ITEM, PROCESS). Two rows naming the same process on
     the same item would each be weighed by the item's WHOLE requirement, so
     pulling both would cost the step twice; they are one line, and a second
     row's words are appended to the first's. */
  const materialProc = new Map<string, PulledCostLine | null>(); // null = counted as skipped
  for (const r of (materialProcRes.data ?? []) as unknown as MaterialProcRow[]) {
    if (!r.bom || r.bom.is_draft || !r.bom.garment_order_id) continue;
    if (!wanted.has(r.bom.garment_order_id)) continue;
    // NO PROCESS OR NO ITEM, NO LINE — a row the operator is still typing.
    if (!r.process_id || !r.item_id || !r.process?.name) continue;
    const key = `${r.amendment_id}::${r.item_id}::${r.process_id}`;
    const words = [r.for_scope, r.description].map((w) => w?.trim()).filter(Boolean) as string[];
    if (materialProc.has(key)) {
      const held = materialProc.get(key);
      const extra = words.filter((w) => held && !held.description.includes(w));
      if (held && extra.length) held.description = [held.description, ...extra].join(" · ");
      continue;
    }
    const need = needByBomItem.get(`${r.amendment_id}::${r.item_id}`);
    /* NO WEIGHT, NO LINE — AND COUNTED. A partial sum (some of the item's
       requirement rows refused) is refused too: one line stands for the whole
       item, so a part of its weight is a wrong number, not a smaller right
       one. */
    if (!need || need.refused || !(need.qty > 0)) {
      skipped++;
      materialProc.set(key, null); // counted once per key, not once per row
      continue;
    }
    materialProc.set(key, {
      source: "material_process",
      garment_order_id: r.bom.garment_order_id,
      item_id: r.item_id,
      description: [r.process.name, ...words].join(" · "),
      qty: need.qty,
      uom_id: need.uoms.size === 1 ? [...need.uoms][0] : null,
      // The process row carries no rate. Left null on purpose — see the header.
      rate: null,
      ...PULLED_DEFAULTS,
      process_id: r.process_id,
      basis: "process",
    });
  }
  for (const l of materialProc.values()) {
    if (!l) continue;
    if (l.item_id) itemIds.add(l.item_id);
    lines.push(l);
  }

  /* ONE READ OF WHAT EACH ORDER MAKES, for both tabs that are labour on it —
     and one PCS lookup for both. */
  const [styleFacts, pcsRes] = await Promise.all([
    styleFactsByOrder(garmentOrderIds),
    /* "PCS" — the unit a garment is counted in, if the Stock Unit master has
       it. Looked up by CODE and left null when absent: inventing a uom id is
       not possible, and a wrong one would label the row. */
    s.from("uoms").select("id").eq("code", "PCS").limit(1).maybeSingle(),
  ]);
  if (pcsRes.error) throw new Error(`Could not read the PCS unit: ${pcsRes.error.message}`);
  const pcsUomId = (pcsRes.data as { id: string } | null)?.id ?? null;

  lines.push(
    ...garmentProcessLines(
      (garmentProcRes.data ?? []) as unknown as GarmentProcRow[],
      styleFacts,
      pcsUomId,
      () => skipped++,
    ),
  );

  // ---- CMT (0574) — see the header ----
  for (const orderId of garmentOrderIds) {
    const facts = styleFacts.get(orderId);
    if (!facts) continue;
    for (const st of facts.styles) {
      /* NO SQ QTY, NO LINE — AND COUNTED. A refused SQ Qty (no approval rows,
         a rejection rule with a gap) is a question the order has not answered;
         0 pieces is not a CMT charge of nothing. */
      if (st.sq_qty == null || !(st.sq_qty > 0)) {
        skipped++;
        continue;
      }
      const split = !facts.is_set_pack && st.coordinates.length > 0;
      /* THE UNIT the qty is counted in: pieces of a coordinate when split, or
         on a set pack; a whole unsplit `set` style is SETS, and there is no
         SET unit on the master to name — so nothing, never a wrong PCS. */
      const uom = split || facts.is_set_pack || st.unit_kind !== "set" ? pcsUomId : null;
      for (const coord of split ? st.coordinates : [null]) {
        if (coord) itemIds.add(coord.id);
        lines.push({
          source: "cmt",
          garment_order_id: orderId,
          item_id: coord?.id ?? null,
          /* The coordinate's name is prefixed by the caller ("TOP · …"). "—" is
             the placeholder a nameless style falls back to, replaced by the
             item name when there is one. */
          description: st.style_description?.trim() || st.style_ref_no || "—",
          qty: st.sq_qty,
          uom_id: uom,
          // No CMT master or rate card exists — the planner prices it.
          rate: null,
          ...PULLED_DEFAULTS,
          style_ref_no: st.style_ref_no,
        });
      }
    }
  }

  // Name the items, so a pulled line reads as a material rather than as a slice
  // label on its own.
  if (itemIds.size > 0) {
    const { data, error } = await s.from("items").select("id, name").in("id", [...itemIds]);
    if (error) throw new Error(`Could not read the item names: ${error.message}`);
    const names = new Map(((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
    for (const l of lines) {
      /* NOT on a Yarn Processes line (2026-09-19): that grid has its own Yarn
         column now, and the prefix pushed the shade out of a 88px cell. */
      const n = l.item_id && l.source !== "yarn_process" ? names.get(l.item_id) : null;
      if (n) l.description = l.description === "—" ? n : `${n} · ${l.description}`;
    }
  }

  return { lines, skipped };
}

/**
 * Every Fabric BOM's report, ONE CALL PER BOM — shared by the cloth purchase
 * and the fabric processes, which both read it. A second call per BOM would be
 * a second walk of every ladder for the same answer.
 */
async function fabricReportsFor(
  bomIds: readonly string[],
): Promise<Map<string, YarnFabricRequirementReport | { refused: string }>> {
  return new Map(
    await Promise.all(
      [...new Set(bomIds)].map(async (id) => [id, await yarnFabricRequirementReport(id)] as const),
    ),
  );
}

/**
 * The Fabric BOM's `fabric` and `fabric_process` lines.
 *
 * ## `fabric` — only the cloth the factory BUYS, at the roll weight
 *
 * See `pullCostLines`'s header for why both halves of that sentence matter.
 *
 * ## `fabric_process` — one line per (process, fabric), at `toOrderedWt`
 *
 * The report's Process Stage Ledger prints two weights per step, Planned Wt
 * and To Ordered Wt. The route is walked BACKWARD from the cutting-floor net
 * (reports.ts, "REVERSED before walking"), so for any step `plannedWt` is
 * `net x factorBefore` — the cloth that must COME OUT of it — and `toOrderedWt`
 * is `net x factorAfter`, the cloth that must GO IN, grossed by the step's own
 * loss (legacy's "Dyeing's own step alone, 1460.029 -> 1536.873").
 *
 * A process is charged on what is SENT to it: a dye house weighs and invoices
 * the greige it receives, not the finished cloth it returns, and a knitter is
 * paid on the yarn it knits. So the budget's Reqd is `toOrderedWt` — the
 * column legacy itself calls "To Ordered", i.e. what the process is ordered
 * for. `plannedWt` would under-cost every step by exactly that step's loss.
 *
 * A fabric's lines are summed over colourway and panel here (`basis =
 * 'fabric'`); the screen re-splits from `loadFabricProcessBreakdown` when the
 * operator changes For. Steps a bought fabric suppresses are already absent —
 * the report drops them (0564).
 *
 * ## WHAT IS COUNTED AS SKIPPED
 *
 * A refused requirement row of a bought cloth; a report that refused outright
 * (once for its processes, once per bought cloth); a bought cloth whose net the
 * report's ladder did not place in full; and every entry of the report's own
 * `stageLedgerRefusals` — each is a weight the ledger could not place, and so
 * a process line short by that much.
 */
async function fabricBomLines(
  s: Awaited<ReturnType<typeof createClient>>,
  reqs: readonly {
    item_id: string | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    line: { rate: number | null } | null;
    bom: { id: string; garment_order_id: string } | null;
  }[],
): Promise<{ lines: PulledCostLine[]; skipped: number; shadeDyedYarns: Set<string> }> {
  let skipped = 0;
  /** `garment_order_id|yarn item_id` of every yarn given per-shade dyeing
   *  lines below — the caller drops that yarn's hand-typed DYED-stage step. */
  const shadeDyedYarns = new Set<string>();
  const bomIds = [...new Set(reqs.flatMap((r) => (r.bom ? [r.bom.id] : [])))];
  if (bomIds.length === 0) return { lines: [], skipped, shadeDyedYarns };

  /* EACH FABRIC'S SOURCE. A failed read THROWS: coalesced to empty, every
     fabric would read Rule 1 and the whole fabric bill would silently vanish
     from the budget — the double count fixed by under-counting instead. */
  const { data: scopeRows, error: scopeErr } = await s
    .from("order_fabric_bom_process_scope")
    .select("bom_id, item_id, source")
    .in("bom_id", bomIds);
  if (scopeErr) throw new Error(`Could not read where each fabric comes from: ${scopeErr.message}`);
  const sourceOf = new Map<string, FabricSource>(
    ((scopeRows ?? []) as { bom_id: string; item_id: string; source: string | null }[]).map((r) => [
      `${r.bom_id}::${r.item_id}`,
      asFabricSource(r.source),
    ]),
  );

  /* EACH (BOM, FABRIC)'S UNIT AND ORDER — for every fabric, bought or knitted,
     because the process lines need them too. One unit or none. */
  const orderOfBom = new Map<string, string>();
  const uomsOf = new Map<string, Set<string>>();
  for (const r of reqs) {
    if (!r.bom || !r.item_id) continue;
    orderOfBom.set(r.bom.id, r.bom.garment_order_id);
    const key = `${r.bom.id}::${r.item_id}`;
    const u = uomsOf.get(key) ?? new Set<string>();
    if (r.consumption_uom_id) u.add(r.consumption_uom_id);
    uomsOf.set(key, u);
  }
  const uomOf = (key: string) => {
    const u = uomsOf.get(key);
    return u && u.size === 1 ? [...u][0] : null;
  };

  type Bought = {
    bomId: string;
    itemId: string;
    garmentOrderId: string;
    /** Σ answered `required_qty` — what the report's ladder must account for. */
    net: number;
    rates: Set<number>;
  };
  const bought = new Map<string, Bought>();
  for (const r of reqs) {
    if (!r.bom || !r.item_id) continue;
    const key = `${r.bom.id}::${r.item_id}`;
    /* RULE 1 RAISES NO FABRIC LINE — its cost is the yarn, pulled as `yarn`.
       Not counted as skipped either: nothing was owed on this line. A refused
       requirement on a knitted fabric surfaces as the YARN's refusal, and the
       yarn branch counts it there. */
    if (!sourceBuysCloth(sourceOf.get(key) ?? "yarn_knit")) continue;
    if (r.required_qty == null) {
      skipped++;
      continue;
    }
    const b = bought.get(key) ?? {
      bomId: r.bom.id,
      itemId: r.item_id,
      garmentOrderId: r.bom.garment_order_id,
      net: 0,
      rates: new Set<number>(),
    };
    b.net += Number(r.required_qty);
    if (r.line?.rate != null) b.rates.add(Number(r.line.rate));
    bought.set(key, b);
  }

  const reports = await fabricReportsFor(bomIds);
  const lines: PulledCostLine[] = [];

  for (const b of bought.values()) {
    const report = reports.get(b.bomId);
    if (!report || isReportRefusal(report)) {
      skipped++;
      continue;
    }
    const cloth = report.clothPurchase.filter((l) => l.fabricId === b.itemId);
    /* THE LADDER MUST ACCOUNT FOR THE WHOLE NET. A panel set its route
       refuses is dropped from `clothPurchase` and named only in the report's
       `stageLedgerRefusals`; pulling what is left would be a fabric bill short
       by one panel with nothing saying so. Compared on the NET, which both
       sides read from the same stored `required_qty`. */
    const placed = cloth.reduce((a, l) => a + l.netWt, 0);
    if (placed < b.net - 1e-4) skipped++;

    /* ONE RATE OR NONE — a price is per fabric, and two lines quoting two
       prices for one cloth is a question for the planner, not a pick. */
    const rate = b.rates.size === 1 ? [...b.rates][0] : null;
    const uom = uomOf(`${b.bomId}::${b.itemId}`);
    for (const l of cloth) {
      if (!(l.purchaseWt > 0)) continue; // nothing to buy is not a line
      lines.push({
        source: "fabric",
        garment_order_id: b.garmentOrderId,
        item_id: b.itemId,
        /* The report's own heading ("Greige Fabric Roll Weight", from
           `clothPurchaseLabel`), then the colourway and panel that make this
           a separate lot. The item name is prefixed by the caller. */
        description: [l.label, l.combo, l.component].filter(Boolean).join(" · "),
        qty: l.purchaseWt,
        uom_id: uom,
        rate,
        ...PULLED_DEFAULTS,
      });
    }
  }

  // ---- the fabric processes, from the same reports ----
  for (const bomId of bomIds) {
    const report = reports.get(bomId);
    const garmentOrderId = orderOfBom.get(bomId);
    if (!garmentOrderId) continue;
    if (!report || isReportRefusal(report)) {
      skipped++;
      continue;
    }
    skipped += report.stageLedgerRefusals.length;

    for (const group of report.stageBreakdown) {
      const byFabric = new Map<string, { name: string; qty: number }>();
      for (const l of group.lines) {
        /* A LINE WITH NO FABRIC ID cannot be keyed to a fabric, and a budget
           line keyed to nothing would be a charge for an unnamed cloth. The
           report fills `itemId` on every line it writes, so this is a guard,
           not a branch. */
        if (!l.itemId) {
          skipped++;
          continue;
        }
        const held = byFabric.get(l.itemId) ?? { name: l.fabricName, qty: 0 };
        held.qty += l.toOrderedWt;
        byFabric.set(l.itemId, held);
      }
      for (const [itemId, f] of byFabric) {
        if (!(f.qty > 0)) continue;
        lines.push({
          source: "fabric_process",
          garment_order_id: garmentOrderId,
          item_id: itemId,
          // The fabric's name is prefixed by the caller: "SINGLE JERSEY · DYEING".
          description: group.processName,
          qty: Number(f.qty.toFixed(6)),
          uom_id: uomOf(`${bomId}::${itemId}`),
          /* NO RATE. `order_fabric_bom_processes.rate` (0492) is gone from the
             live table; the Fabric Process tab is a route, not a price list. */
          rate: null,
          ...PULLED_DEFAULTS,
          process_id: group.processId,
          basis: "fabric",
        });
      }
    }
  }

  /* ---- YARN DYEING, ONE LINE PER YARN x SHADE (client 2026-09-19, Rule 3) --
     "Value-addition processes like Yarn Dyeing … automatically flow into the
     Yarn Processes tab", one line per Yarn Description x Shade Colour, the
     merchandiser typing the rate per KG.

     READ OFF THE REPORT'S YARN DYEING BLOCK — the same per-shade figures the
     printed Yarn & Fabric Requirement shows, so the budget and the document a
     dye house is given cannot disagree. Summed across garment colourways: a
     shade dyed for two colourways is one dye lot and one charge.

     THE WEIGHT IS `toOrderedWt` — the grey yarn SENT to the dye house for
     that shade, i.e. the dyed weight grossed by the shade's own loss. That is
     what a per-kg dyeing charge is levied on.

     THIS IS A CHARGE, NEVER A PURCHASE. The grey yarn's purchase weight already
     carries the shade losses (`shadeDyeFactor`); these lines only cost the
     dyeing. And because a hand-typed YARN DYEING step on the same yarn would
     charge the same dyeing again, `pullCostLines` drops that step's line for
     every yarn listed in `shadeDyedYarns` (the double-count rule, 2026-09-19). */
  const { data: yarnUomRows, error: yarnUomErr } = await s
    .from("order_fabric_bom_yarns")
    .select("bom_id, item_id, uom_id")
    .in("bom_id", bomIds);
  if (yarnUomErr) throw new Error(`Could not read the yarn units: ${yarnUomErr.message}`);
  const yarnUom = new Map(
    ((yarnUomRows ?? []) as { bom_id: string; item_id: string; uom_id: string | null }[]).map((r) => [
      `${r.bom_id}::${r.item_id}`,
      r.uom_id,
    ]),
  );
  /* THE PROCESS THE LINE CHARGES FOR — the Process master's yarn-dyeing row.
     Picked only when the master answers unambiguously (exactly one `for_yarn`
     process named like DYE); otherwise left blank for the merchandiser to pick,
     rather than guessed. The description still says YARN DYEING. */
  const { data: dyeProcRows } = await s
    .from("processes")
    .select("id, name")
    .eq("for_yarn", true)
    .ilike("name", "%dye%");
  const dyeProcs = (dyeProcRows ?? []) as { id: string; name: string }[];
  const dyeProcess =
    dyeProcs.length === 1 ? dyeProcs[0] : (dyeProcs.find((p) => p.name.trim().toUpperCase() === "YARN DYEING") ?? null);

  for (const bomId of bomIds) {
    const report = reports.get(bomId);
    const garmentOrderId = orderOfBom.get(bomId);
    if (!garmentOrderId || !report || isReportRefusal(report)) continue;
    for (const sh of shadeDyeingCharges(report.yarnDyeing)) {
      shadeDyedYarns.add(`${garmentOrderId}|${sh.yarnItemId}`);
      lines.push({
        source: "yarn_process",
        garment_order_id: garmentOrderId,
        item_id: sh.yarnItemId,
        /* JUST THE SHADE — the Yarn and Process columns name the rest. */
        description: sh.colorName,
        qty: sh.qty,
        uom_id: yarnUom.get(`${bomId}::${sh.yarnItemId}`) ?? null,
        rate: null,
        ...PULLED_DEFAULTS,
        process_id: dyeProcess?.id ?? null,
        basis: "color",
        /* THE SHADE IS THE LOT — what keeps two shades of one yarn two lines
           (`pulledLineKey` reads `combo`). */
        combo: sh.colorName,
      });
    }
  }
  return { lines, skipped, shadeDyedYarns };
}

/** One Style ▸ Process row (0411), as `pullCostLines` reads it. */
type GarmentProcRow = {
  amendment_id: string;
  style_ref_no: string | null;
  kind: string | null;
  process_id: string | null;
  component_id: string | null;
  process: { name: string } | null;
  component: { short_name: string | null } | null;
};

/**
 * The `garment_process` lines — one per Style ▸ Process row.
 *
 * ## QTY IS THE STYLE'S SQ QTY — THE SAME PIECES CMT IS CHARGED ON (0574)
 *
 * A garment process is done to every garment the floor makes, not to every
 * garment the buyer ordered — the excess, the approval samples and the
 * rejection allowance all go through the embroidery machine too. Phase 2 read
 * that as `materialTarget` (the Material BOM's base, with the FLAT Rejection
 * %). Phase 3 moved it onto the legacy SQ Qty (`qtyBreakdownOf`, with the
 * TIERED rejection projection) because CMT reads SQ Qty and a garment process
 * is labour on the same garments: two bases in one budget would cost one
 * factory run as two different numbers of pieces, and the client's blueprint
 * anchors garment Reqd on SQ Qty (5321, not the order's 5028).
 *
 * ## No of Pcs and No of Units are 1
 *
 * Stated, not left null, so the row reads 1 × 1 and the operator can see the
 * two multipliers exist. `lineReqd` multiplies them into Reqd.
 *
 * ## A STYLE WITH NO SQ QTY IS SKIPPED AND COUNTED
 *
 * Refused (no approval rows, a rejection rule with a gap) or 0 — a process
 * line of 0 garments would read as "this step costs nothing".
 */
function garmentProcessLines(
  rows: readonly GarmentProcRow[],
  styleFacts: ReadonlyMap<string, OrderStyleFacts>,
  pcsUomId: string | null,
  skip: () => void,
): PulledCostLine[] {
  const lines: PulledCostLine[] = [];
  for (const r of rows) {
    if (!r.process_id || !r.process?.name) continue;
    if (r.kind !== "garment" && r.kind !== "component") continue;
    const style = styleKey(r.style_ref_no);
    const target = styleFacts.get(r.amendment_id)?.styles.find((st) => st.style_ref_no === style)?.sq_qty;
    if (target == null || !(target > 0)) {
      skip();
      continue;
    }
    const component = r.kind === "component" ? r.component?.short_name?.trim() || null : null;
    lines.push({
      source: "garment_process",
      garment_order_id: r.amendment_id,
      item_id: null,
      // "PROCESS · STYLE · COMPONENT" — no item to prefix, so it names itself.
      description: [r.process.name, r.style_ref_no?.trim(), component].filter(Boolean).join(" · "),
      qty: target,
      uom_id: pcsUomId,
      rate: null,
      ...PULLED_DEFAULTS,
      process_id: r.process_id,
      basis: r.kind === "component" ? "part" : "process",
      no_of_pcs: 1,
      no_of_units: 1,
      /* THE LINE'S IDENTITY, in columns — without them the same process on
         two styles (or two components) is one key, and a re-pull keeps one.
         Stored as `styleKey` normalises it, which is how the order compares. */
      style_ref_no: style,
      component_id: r.kind === "component" ? r.component_id : null,
    });
  }
  return lines;
}

/**
 * The Fabric Processes breakdown at FULL grain — one row per (process, fabric,
 * colourway, panel) exactly as the report's stage ledger holds it — for the
 * screen to re-split a group when the operator changes For
 * (`splitFabricProcess` in ./totals).
 *
 * The weight is `toOrderedWt`, for `fabricBomLines`' reason; a split and the
 * pulled line it replaces must add up to the same kilograms.
 */
export type FabricProcessGroup = {
  garment_order_id: string;
  process_id: string;
  process_name: string;
  uom_id: string | null;
  rows: FabricProcessRow[];
};

export async function fabricProcessBreakdown(
  garmentOrderIds: readonly string[],
): Promise<{ groups: FabricProcessGroup[]; refusals: string[] }> {
  if (garmentOrderIds.length === 0) return { groups: [], refusals: [] };
  const s = await createClient();
  const { data: boms, error } = await s
    .from("order_fabric_boms")
    .select("id, garment_order_id")
    .in("garment_order_id", [...garmentOrderIds])
    .eq("is_draft", false);
  if (error) throw new Error(`Could not read the Fabric BOMs: ${error.message}`);
  const bomRows = (boms ?? []) as { id: string; garment_order_id: string }[];
  if (bomRows.length === 0) return { groups: [], refusals: [] };

  const [reports, reqRes] = await Promise.all([
    fabricReportsFor(bomRows.map((b) => b.id)),
    s
      .from("order_fabric_bom_requirements")
      .select("bom_id, consumption_uom_id")
      .in("bom_id", bomRows.map((b) => b.id)),
  ]);
  if (reqRes.error) throw new Error(`Could not read the Fabric BOM units: ${reqRes.error.message}`);
  // ONE UNIT PER BOM OR NONE — the ledger's weights are the requirement's unit.
  const uomsByBom = new Map<string, Set<string>>();
  for (const r of (reqRes.data ?? []) as { bom_id: string; consumption_uom_id: string | null }[]) {
    const u = uomsByBom.get(r.bom_id) ?? new Set<string>();
    if (r.consumption_uom_id) u.add(r.consumption_uom_id);
    uomsByBom.set(r.bom_id, u);
  }

  const groups: FabricProcessGroup[] = [];
  const refusals: string[] = [];
  for (const b of bomRows) {
    const report = reports.get(b.id);
    if (!report || isReportRefusal(report)) {
      refusals.push(report ? report.refused : "The Fabric BOM report could not be produced");
      continue;
    }
    refusals.push(...report.stageLedgerRefusals);
    const u = uomsByBom.get(b.id);
    const uom = u && u.size === 1 ? [...u][0] : null;
    for (const g of report.stageBreakdown) {
      groups.push({
        garment_order_id: b.garment_order_id,
        process_id: g.processId,
        process_name: g.processName,
        uom_id: uom,
        rows: g.lines.map((l) => ({
          item_id: l.itemId,
          fabric_name: l.fabricName,
          combo: l.combo,
          qty: l.toOrderedWt,
        })),
      });
    }
  }
  return { groups, refusals };
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

const BUDGET_SELECT =
  "*, " +
  "orders:order_budget_orders(*, garment_order:garment_order_amendments(id, code, po_no, delivery_date, " +
  "customer:customers(id,name), sales_order:sales_orders(order_number))), " +
  "lines:order_budget_lines(*), " +
  // The Amendment Protocol history (0576). One FK to order_budgets, so bare.
  "revisions:order_budget_revisions(*)";

/** Sort a budget's children and resolve its revisions' reopeners, for one
 *  budget or a list. */
async function shapeBudgets(rows: OrderBudget[]): Promise<OrderBudget[]> {
  const shaped = rows.map((b) => ({
    ...b,
    orders: [...(b.orders ?? [])].sort((a, c) => a.sno - c.sno),
    lines: [...(b.lines ?? [])].sort((a, c) => a.sno - c.sno),
    revisions: [...(b.revisions ?? [])].sort((a, c) => a.revision_no - c.revision_no),
  }));

  /* WHO REOPENED IT, by name — through `creator_names()`, the SECURITY DEFINER
     lookup `withCreators` uses, never a `profiles` embed (which RLS resolves
     to null for everyone but the reader — lib/created-by.ts). */
  const ids = [
    ...new Set(
      shaped.flatMap((b) => b.revisions.flatMap((r) => [r.reopened_by, r.baseline_approved_by])).filter(Boolean),
    ),
  ] as string[];
  if (ids.length > 0) {
    const s = await createClient();
    const { data, error } = await s.rpc("creator_names", { ids });
    // A name that cannot be read is a dash on screen, not a failed page — the
    // revision itself (who, why, when) is still there.
    if (!error) {
      const byId = new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
      for (const b of shaped) {
        const name = (id: string | null) => (id ? (byId.get(id) ?? null) : null);
        b.revisions = b.revisions.map((r) => ({
          ...r,
          reopened_by_name: name(r.reopened_by),
          baseline_approved_by_name: name(r.baseline_approved_by),
        }));
      }
    }
  }
  return withCreators(shaped);
}

export async function listOrderBudgets(): Promise<OrderBudget[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("order_budgets")
    .select(BUDGET_SELECT)
    .order("created_at", { ascending: false });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — an empty budget list reads
  // as "nothing budgeted yet", which is believable and wrong. Thrown, so the
  // route's error boundary names it.
  if (error) throw new Error(`Could not read the budgets: ${error.message}`);
  return shapeBudgets((data ?? []) as unknown as OrderBudget[]);
}

/** One budget, whole — what submit and reopen compute their figures from. */
export async function getOrderBudget(id: string): Promise<OrderBudget | null> {
  const s = await createClient();
  const { data, error } = await s.from("order_budgets").select(BUDGET_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the budget: ${error.message}`);
  if (!data) return null;
  return (await shapeBudgets([data as unknown as OrderBudget]))[0];
}

/**
 * A budget's figures, as the screen would show them now — lines as stored,
 * orders' facts as `listBudgetableOrders` values them (the screen's own
 * source), in the budget's order. `budgetFigures` assembles the engine's
 * inputs, the same function the screen calls.
 *
 * An order the menu no longer lists (drafted back, deleted) is left out — and
 * its absence refuses nothing by itself, so it is said: the facts list is
 * returned beside the figures for the caller to compare.
 */
export async function budgetFiguresOf(
  budget: OrderBudget,
): Promise<BudgetFigures & { facts: BudgetableOrder[] }> {
  const all = await listBudgetableOrders();
  const byId = new Map(all.map((o) => [o.id, o] as const));
  const facts = budget.orders
    .map((o) => byId.get(o.garment_order_id))
    .filter((o): o is BudgetableOrder => !!o);
  if (facts.length !== budget.orders.length) {
    throw new Error("One of this budget's orders can no longer be read — it may have been drafted or deleted");
  }
  return { ...budgetFigures({ lines: budget.lines, facts, entryDate: budget.budget_date }), facts };
}

/**
 * The approval queue — step 6.
 *
 * IT LISTS EVERY BUDGET, not only the submitted ones, and the filter is the
 * screen's. An approver who can see only what is waiting cannot answer "what did
 * I approve last week?" or find the budget they rejected — and a queue that
 * empties to nothing looks broken rather than finished. The default filter is
 * still Awaiting approval, so the work is what opens.
 */
export async function listBudgetsForApproval(): Promise<BudgetApprovalRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_budgets")
    .select(
      "id, code, budget_date, description, status, submitted_at, decided_at, " +
        "decision_remark, created_at, created_by, " +
        "orders:order_budget_orders(id), lines:order_budget_lines(id)",
    )
    .order("submitted_at", { ascending: false, nullsFirst: false });

  type Row = BudgetApprovalRow & {
    orders: { id: string }[] | null;
    lines: { id: string }[] | null;
  };

  return withCreators(
    ((data ?? []) as unknown as Row[]).map((b) => ({
      id: b.id,
      code: b.code,
      budget_date: b.budget_date,
      description: b.description,
      status: b.status,
      order_count: b.orders?.length ?? 0,
      line_count: b.lines?.length ?? 0,
      submitted_at: b.submitted_at,
      decided_at: b.decided_at,
      decision_remark: b.decision_remark,
      created_at: b.created_at,
      created_by: b.created_by,
    })),
  );
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

async function getItemRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("items").select("id, code, name, is_active").order("name");
  return ((data ?? []) as (Omit<PickerRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    inactive: isInactive(r),
  }));
}

async function getUomRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("uoms").select("id, code, name, is_active").order("name");
  return ((data ?? []) as (Omit<PickerRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    inactive: isInactive(r),
  }));
}

/**
 * A process, for the Process Rates tabs' hand-added rows (0573). `processes`
 * has no `code` column, so `code` is null; the four `for_*` flags are the
 * master's own applicability answers (0227), carried so a tab can offer only
 * the processes that apply to it.
 */
export type ProcessPickerRow = PickerRow & {
  for_yarn: boolean;
  for_fabric: boolean;
  for_trims: boolean;
  for_garments: boolean;
  for_components: boolean;
};

async function getProcessRows(): Promise<ProcessPickerRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("processes")
    .select("id, name, inactive, for_yarn, for_fabric, for_trims, for_garments, for_components")
    .order("name");
  // An empty process list reads as "no processes in the master" — say the real
  // reason instead. Thrown, so the route's error boundary shows it.
  if (error) throw new Error(`Could not read the processes: ${error.message}`);
  type Row = {
    id: string;
    name: string;
    inactive: boolean | null;
    for_yarn: boolean | null;
    for_fabric: boolean | null;
    for_trims: boolean | null;
    for_garments: boolean | null;
    for_components: boolean | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    code: null,
    name: r.name,
    inactive: isInactive(r),
    for_yarn: r.for_yarn === true,
    for_fabric: r.for_fabric === true,
    for_trims: r.for_trims === true,
    for_garments: r.for_garments === true,
    for_components: r.for_components === true,
  }));
}

/**
 * The Expense and Income Heads (0575), in the shape `LookupDialogPicker`'s
 * `options` takes — `ConfigLookup`, exactly what Packing Advice hands its
 * Warehouse picker (`listConfigLookups()`), so inline Add / Modify behave the
 * same here. The screen filters by `kind` per tab.
 *
 * INACTIVE ROWS ARE SELECTED, NOT FILTERED (AGENTS.md "Disabled rows"): a line
 * already booked under a since-retired head must still resolve to its name, or
 * the field reads empty and the next save blanks it. The picker hides it from
 * new choices through `is_active`, as it does everywhere.
 */
async function getBudgetHeadLookups(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("config_lookups")
    .select("id, kind, code, name, notes, is_active, type_code")
    /* `yarn_stage` rides along (0590): Yarn Purchases' Stage dropdown lists
       the same GREY / DYED rows the Fabric BOM's Yarn Process lists. */
    .in("kind", ["expense_head", "income_head", "yarn_stage"])
    .order("name");
  // An empty picker reads as "no heads set up" — say the real reason instead.
  if (error) throw new Error(`Could not read the expense and income heads: ${error.message}`);
  return (data ?? []) as ConfigLookup[];
}

export type CurrencyRow = { code: string; name: string };

async function getCurrencies(): Promise<CurrencyRow[]> {
  const s = await createClient();
  // `currencies` has no disable column at all — one of the two exemptions
  // AGENTS.md names under Disabled rows (`FLAGLESS_PICKERS`).
  const { data } = await s.from("currencies").select("code, name").order("code");
  return (data ?? []) as CurrencyRow[];
}

export type BudgetFormData = {
  orders: BudgetableOrder[];
  items: PickerRow[];
  uoms: PickerRow[];
  currencies: CurrencyRow[];
  processes: ProcessPickerRow[];
  /** Expense / Income Heads (`expense_head` / `income_head`) and the yarn
   *  stages (`yarn_stage`, 0590) — filter by `kind` at the use site. */
  lookups: ConfigLookup[];
};

export async function getBudgetFormData(): Promise<BudgetFormData> {
  const [orders, items, uoms, currencies, processes, lookups] = await Promise.all([
    listBudgetableOrders(),
    getItemRows(),
    getUomRows(),
    getCurrencies(),
    getProcessRows(),
    getBudgetHeadLookups(),
  ]);
  return { orders, items, uoms, currencies, processes, lookups };
}
