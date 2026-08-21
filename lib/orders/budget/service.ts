import "server-only";
import {
  ASSORT_WEIGHT_SELECT,
  assortSizeWeights,
  type AssortQuantity,
} from "@/lib/orders/assort-weights";
import { createClient } from "@/lib/supabase/server";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import { orderValue } from "@/lib/orders/amendments/order-value";
import { orderSalesValue } from "./totals";
import type { BudgetSource } from "./totals";
import type {
  BudgetApprovalRow,
  BudgetableOrder,
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
 */
async function salesValuesByOrder(): Promise<
  Map<string, { value: number | null; refusal: string | null }>
> {
  const s = await createClient();
  const { data } = await s
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

  const out = new Map<string, { value: number | null; refusal: string | null }>();
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
    out.set(
      r.id,
      orderSalesValue({
        grossValue: v.grossValue,
        unresolved: v.unresolved,
        exRate: Number(r.ex_rate) || 0,
        currencyCode: r.currency_code,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The orders a budget can pick up
// ---------------------------------------------------------------------------

export async function listBudgetableOrders(): Promise<BudgetableOrder[]> {
  const s = await createClient();

  const [values, ordersRes, coveredRes, fabricRes, materialRes] = await Promise.all([
    salesValuesByOrder(),
    s
      .from("garment_order_amendments")
      .select(
        "id, code, po_no, delivery_date, customer:customers(name), " +
          "sales_order:sales_orders(order_number)",
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
  ]);

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
  };

  return ((ordersRes.data ?? []) as unknown as OrderRow[]).map((o) => {
    const v = values.get(o.id) ?? { value: null, refusal: "this order could not be read" };
    return {
      id: o.id,
      sc_no: o.sales_order?.order_number ?? null,
      order_code: o.code,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      delivery_date: o.delivery_date,
      sales_value: v.value,
      sales_refusal: v.refusal,
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
};

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
 * The Fabric BOM carries a `rate` per line; the Material BOM does not. A missing
 * rate arrives as null and the operator types it — it is NOT defaulted to a
 * last-purchase price, because a budget that quietly priced itself from history
 * is a budget nobody checked.
 */
export async function pullCostLines(
  garmentOrderIds: readonly string[],
): Promise<{ lines: PulledCostLine[]; skipped: number }> {
  if (garmentOrderIds.length === 0) return { lines: [], skipped: 0 };
  const s = await createClient();

  const [fabricRes, materialRes] = await Promise.all([
    s
      .from("order_fabric_bom_requirements")
      .select(
        "item_id, required_qty, consumption_uom_id, slice_label, " +
          "line:order_fabric_bom_lines(rate), " +
          "bom:order_fabric_boms(garment_order_id, is_draft)",
      ),
    s
      .from("material_bom_amendment_requirements")
      .select(
        "item_id, required_qty, consumption_uom_id, slice_label, " +
          "bom:material_bom_amendments(garment_order_id, is_draft)",
      ),
  ]);

  const wanted = new Set(garmentOrderIds);
  const itemIds = new Set<string>();
  let skipped = 0;

  type FabricReq = {
    item_id: string | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    slice_label: string;
    line: { rate: number | null } | null;
    bom: { garment_order_id: string; is_draft: boolean } | null;
  };
  type MaterialReq = {
    item_id: string | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    slice_label: string;
    bom: { garment_order_id: string | null; is_draft: boolean } | null;
  };

  const lines: PulledCostLine[] = [];

  for (const r of (fabricRes.data ?? []) as unknown as FabricReq[]) {
    // A DRAFT BOM IS NOT PULLED. Its figures are someone's half-finished
    // thinking, and a budget built on them would be approved against numbers
    // that were never recorded.
    if (!r.bom || r.bom.is_draft || !wanted.has(r.bom.garment_order_id)) continue;
    if (r.required_qty == null) {
      skipped++;
      continue;
    }
    if (r.item_id) itemIds.add(r.item_id);
    lines.push({
      source: "fabric",
      garment_order_id: r.bom.garment_order_id,
      item_id: r.item_id,
      description: r.slice_label,
      qty: Number(r.required_qty),
      uom_id: r.consumption_uom_id,
      rate: r.line?.rate == null ? null : Number(r.line.rate),
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
      // The Material BOM stores no rate. Left null on purpose — see the header.
      rate: null,
    });
  }

  // Name the items, so a pulled line reads as a material rather than as a slice
  // label on its own.
  if (itemIds.size > 0) {
    const { data } = await s.from("items").select("id, name").in("id", [...itemIds]);
    const names = new Map(((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
    for (const l of lines) {
      const n = l.item_id ? names.get(l.item_id) : null;
      if (n) l.description = l.description === "—" ? n : `${n} · ${l.description}`;
    }
  }

  return { lines, skipped };
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

const BUDGET_SELECT =
  "*, " +
  "orders:order_budget_orders(*, garment_order:garment_order_amendments(id, code, po_no, delivery_date, " +
  "customer:customers(id,name), sales_order:sales_orders(order_number))), " +
  "lines:order_budget_lines(*)";

export async function listOrderBudgets(): Promise<OrderBudget[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_budgets")
    .select(BUDGET_SELECT)
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as OrderBudget[]).map((b) => ({
      ...b,
      orders: [...(b.orders ?? [])].sort((a, c) => a.sno - c.sno),
      lines: [...(b.lines ?? [])].sort((a, c) => a.sno - c.sno),
    })),
  );
}

/**
 * The approval queue — step 8.
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
};

export async function getBudgetFormData(): Promise<BudgetFormData> {
  const [orders, items, uoms, currencies] = await Promise.all([
    listBudgetableOrders(),
    getItemRows(),
    getUomRows(),
    getCurrencies(),
  ]);
  return { orders, items, uoms, currencies };
}
