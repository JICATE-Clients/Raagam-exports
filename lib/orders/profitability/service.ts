import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { listBudgetableOrders, listOrderBudgets } from "@/lib/orders/budget/service";
import { budgetFigures } from "@/lib/orders/budget/figures";
import { breakdownOfTotals } from "@/lib/orders/budget/breakdown";
import type { BudgetableOrder, OrderBudget } from "@/lib/orders/budget/types";
import { withCreators } from "@/lib/created-by";
import { staffNames } from "@/lib/orders/staff-names";
import {
  compareProfitability,
  purchaseBucketOf,
  type BucketActual,
  type Fig,
  type ManualBucket,
  type ManualCostRow,
  type ProfitBucketKey,
  type ProfitDocument,
  type ProfitOrderRow,
} from "./types";

/**
 * Order Profitability — the reads (doc/order/digitalisation-plan.md §3).
 *
 * BUDGET: the approved budget per order, through the budget module's own
 * `listOrderBudgets` + `listBudgetableOrders` + `budgetFigures` +
 * `breakdownOfTotals` — the same chain `budgetFiguresOf` runs, called ONCE for
 * every order instead of once per budget (`budgetFiguresOf` re-reads the whole
 * budgetable-orders list each call). Those helpers read through the SESSION
 * client, so this service is a session read; `sb` is used for the actuals.
 *
 * ACTUALS, derived on every read and never stored:
 *   Fabric / Trims — `po_line_items.sales_order_id`, on ISSUED purchase orders
 *     (approved onward — the set the Fabric and Trim T&A trackers use). Committed
 *     = ordered qty × rate; actual = accepted qty on POSTED GRNs × rate. The
 *     item's class decides the bucket (`purchaseBucketOf`).
 *   Process — `process_orders.sales_order_id` (0609), not draft / cancelled.
 *     Committed = sent qty × rate; actual = received qty × rate.
 *   Sales — `shipment_lines` on shipped / delivered / closed shipments, in INR
 *     at the order's own booking rate when the shipment is in a foreign currency.
 *   CMT & Overheads, Other Income — `order_actual_costs` (0667), by hand.
 *
 * NO EMBED ACROSS `purchase_orders`: it has two FKs to vendors (AGENTS.md "A
 * SECOND FK BREAKS EVERY EXISTING EMBED"), so headers are read by id.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. Every actuals table held 0 rows
 * on 2026-10-01, so a silently failing read would look exactly like "nothing
 * bought yet" until the first real document. Every read here throws.
 */

type SB = Awaited<ReturnType<typeof createClient>>;

const PO_ISSUED = new Set(["approved", "partially_received", "received", "closed"]);
const PROCESS_LIVE_EXCLUDED = new Set(["draft", "cancelled"]);
const SHIPPED = new Set(["shipped", "delivered", "closed"]);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} could not be read: ${error.message}. This is an error, not an empty report.`);
}

const EMPTY_BUCKETS = (): Record<ProfitBucketKey, BucketActual> => ({
  fabric: null,
  process: null,
  trims: null,
  cmt_overheads: null,
});

function addTo(
  buckets: Record<ProfitBucketKey, BucketActual>,
  key: ProfitBucketKey,
  committed: number | null,
  actual: number,
  docs: number,
) {
  const prev = buckets[key];
  buckets[key] = {
    committed: committed == null ? prev?.committed ?? null : (prev?.committed ?? 0) + committed,
    actual: (prev?.actual ?? 0) + actual,
    docs: (prev?.docs ?? 0) + docs,
  };
}

/** The approved budget per order — latest approved wins, the rank
 *  `getOrderBudgetReport` applies within its first tier. */
function approvedBudgetByDoc(budgets: OrderBudget[]): Map<string, OrderBudget> {
  const byDoc = new Map<string, OrderBudget>();
  for (const b of budgets) {
    if (b.status !== "approved") continue;
    for (const o of b.orders) {
      const prev = byDoc.get(o.garment_order_id);
      if (!prev || b.created_at > prev.created_at) byDoc.set(o.garment_order_id, b);
    }
  }
  return byDoc;
}

/**
 * Every order with an APPROVED budget, or one order. Entry order (the order's
 * own `created_at`, oldest first — "Listings in ENTRY order").
 */
export async function loadProfitability(
  sb: SB,
  opts: { salesOrderId?: string } = {},
): Promise<ProfitOrderRow[]> {
  const [budgets, budgetable] = await Promise.all([listOrderBudgets(), listBudgetableOrders()]);
  const factsByDoc = new Map<string, BudgetableOrder>(budgetable.map((o) => [o.id, o]));
  const byDoc = approvedBudgetByDoc(budgets);

  const docIds = [...byDoc.keys()];
  if (!docIds.length) return [];

  const { data: docs, error: docErr } = await sb
    .from("garment_order_amendments")
    .select("id, sales_order_id, merchandiser_id, created_at")
    .in("id", docIds);
  fail("Order documents", docErr);
  type Doc = { id: string; sales_order_id: string | null; merchandiser_id: string | null; created_at: string };

  /* One row per RE. Several documents of one RE can each be on a budget; the
     latest approved budget across them decides, as within one document. */
  const perOrder = new Map<string, { doc: Doc; budget: OrderBudget }>();
  for (const d of (docs ?? []) as Doc[]) {
    if (!d.sales_order_id) continue;
    if (opts.salesOrderId && d.sales_order_id !== opts.salesOrderId) continue;
    const budget = byDoc.get(d.id)!;
    const prev = perOrder.get(d.sales_order_id);
    if (!prev || budget.created_at > prev.budget.created_at) perOrder.set(d.sales_order_id, { doc: d, budget });
  }
  const soIds = [...perOrder.keys()];
  if (!soIds.length) return [];

  const merchIds = [...new Set([...perOrder.values()].map((v) => v.doc.merchandiser_id).filter((x): x is string => !!x))];
  const none = Promise.resolve({ data: [], error: null });

  const [soRes, compRes, merchNames, poLineRes, procRes, shipLineRes, manualRes, classRes] = await Promise.all([
    sb.from("sales_orders").select("id, order_number, status").in("id", soIds),
    sb.from("order_completions").select("order_id, completion_date").in("order_id", soIds),
    // Merchandiser is a `staff` id; names via the narrow admin lookup (staff RLS is HR-only).
    staffNames(merchIds),
    sb
      .from("po_line_items")
      .select("id, purchase_order_id, sales_order_id, item_id, item_class, quantity, unit_price, net_rate, is_foc")
      .in("sales_order_id", soIds),
    sb.from("process_orders").select("id, code, status, currency_code, sales_order_id").in("sales_order_id", soIds),
    sb.from("shipment_lines").select("shipment_id, sales_order_id, quantity, amount").in("sales_order_id", soIds),
    sb
      .from("order_actual_costs")
      .select("id, sales_order_id, bucket, description, amount_inr, remarks")
      .in("sales_order_id", soIds)
      .order("created_at", { ascending: true }),
    sb.from("config_lookups").select("id, code").eq("kind", "item_class"),
  ]);
  fail("Orders", soRes.error);
  fail("Order completions", compRes.error);
  fail("Purchase order lines", poLineRes.error);
  fail("Process orders", procRes.error);
  fail("Shipment lines", shipLineRes.error);
  fail("Hand-entered costs", manualRes.error);
  fail("Item classes", classRes.error);

  type PoLine = {
    id: string;
    purchase_order_id: string;
    sales_order_id: string;
    item_id: string | null;
    item_class: string | null;
    quantity: number | null;
    unit_price: number | null;
    net_rate: number | null;
    is_foc: boolean | null;
  };
  type Proc = { id: string; code: string | null; status: string | null; currency_code: string | null; sales_order_id: string };
  type ShipLine = { shipment_id: string; sales_order_id: string; quantity: number | null; amount: number | null };
  type Manual = { id: string; sales_order_id: string; bucket: ManualBucket; description: string; amount_inr: number; remarks: string | null };

  const poLines = (poLineRes.data ?? []) as PoLine[];
  const procs = ((procRes.data ?? []) as Proc[]).filter((p) => !PROCESS_LIVE_EXCLUDED.has(p.status ?? ""));
  const shipLines = (shipLineRes.data ?? []) as ShipLine[];

  const poIds = [...new Set(poLines.map((l) => l.purchase_order_id))];
  const poLineIds = poLines.map((l) => l.id);
  const itemIds = [...new Set(poLines.map((l) => l.item_id).filter((x): x is string => !!x))];
  const procIds = procs.map((p) => p.id);
  const shipIds = [...new Set(shipLines.map((l) => l.shipment_id))];

  const [poRes, grnLineRes, itemRes, procLineRes, shipRes] = await Promise.all([
    poIds.length
      ? sb.from("purchase_orders").select("id, code, status, foreign_currency_code, exchange_rate").in("id", poIds)
      : none,
    poLineIds.length
      ? sb.from("grn_line_items").select("po_line_item_id, grn_id, accepted_qty").in("po_line_item_id", poLineIds)
      : none,
    itemIds.length ? sb.from("items").select("id, item_class_id").in("id", itemIds) : none,
    procIds.length
      ? sb.from("process_order_lines").select("process_order_id, sent_qty, received_qty, rate").in("process_order_id", procIds)
      : none,
    shipIds.length ? sb.from("shipments").select("id, code, status, currency_code").in("id", shipIds) : none,
  ]);
  fail("Purchase orders", poRes.error);
  fail("Goods receipt lines", grnLineRes.error);
  fail("Items", itemRes.error);
  fail("Process order lines", procLineRes.error);
  fail("Shipments", shipRes.error);

  type Po = { id: string; code: string | null; status: string | null; foreign_currency_code: string | null; exchange_rate: number | null };
  type GrnLine = { po_line_item_id: string; grn_id: string; accepted_qty: number | null };
  type ProcLine = { process_order_id: string; sent_qty: number | null; received_qty: number | null; rate: number | null };
  type Ship = { id: string; code: string | null; status: string | null; currency_code: string | null };

  const grnLines = (grnLineRes.data ?? []) as GrnLine[];
  const grnIds = [...new Set(grnLines.map((g) => g.grn_id))];
  const grnRes = grnIds.length ? await sb.from("grns").select("id, status").in("id", grnIds) : { data: [], error: null };
  fail("Goods receipts", grnRes.error);
  const postedGrn = new Set(((grnRes.data ?? []) as { id: string; status: string | null }[]).filter((g) => g.status === "posted").map((g) => g.id));

  const pos = new Map(((poRes.data ?? []) as Po[]).map((p) => [p.id, p]));
  const classCode = new Map(((classRes.data ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
  const itemClass = new Map(((itemRes.data ?? []) as { id: string; item_class_id: string | null }[]).map((i) => [i.id, classCode.get(i.item_class_id ?? "") ?? null]));
  const acceptedByLine = new Map<string, number>();
  for (const g of grnLines) {
    if (!postedGrn.has(g.grn_id)) continue;
    acceptedByLine.set(g.po_line_item_id, (acceptedByLine.get(g.po_line_item_id) ?? 0) + num(g.accepted_qty));
  }
  const procLines = (procLineRes.data ?? []) as ProcLine[];
  const ships = new Map(((shipRes.data ?? []) as Ship[]).map((s) => [s.id, s]));

  const soById = new Map(((soRes.data ?? []) as { id: string; order_number: string | null; status: string | null }[]).map((s) => [s.id, s]));
  const completedOn = new Map(((compRes.data ?? []) as { order_id: string; completion_date: string | null }[]).map((c) => [c.order_id, c.completion_date]));
  const empName = merchNames;
  const manualBySo = new Map<string, Manual[]>();
  for (const m of (manualRes.data ?? []) as Manual[]) manualBySo.set(m.sales_order_id, [...(manualBySo.get(m.sales_order_id) ?? []), m]);

  const rows: ProfitOrderRow[] = [];
  for (const [soId, { doc, budget }] of perOrder) {
    const notes: string[] = [];
    const facts = factsByDoc.get(doc.id) ?? null;

    // ---- BUDGET (the budget module's own figures) ----
    let budgetRefusal: string | null = null;
    let bBuckets: Record<ProfitBucketKey, Fig> = {
      fabric: { refused: "No budget figures" },
      process: { refused: "No budget figures" },
      trims: { refused: "No budget figures" },
      cmt_overheads: { refused: "No budget figures" },
    };
    let bSales: Fig = { refused: "No budget figures" };
    let bIncome: Fig = { refused: "No budget figures" };
    let bProfit: Fig = { refused: "No budget figures" };
    if (budget.orders.length > 1) {
      budgetRefusal = `Budget ${budget.code ?? ""} covers ${budget.orders.length} orders together, so its figures cannot be split per order`;
    } else if (!facts) {
      budgetRefusal = "This order can no longer be read by the budget — it may have been drafted back";
    } else {
      const figs = budgetFigures({ lines: budget.lines, facts: [facts], entryDate: budget.budget_date });
      const bd = breakdownOfTotals(figs.totals);
      bBuckets = Object.fromEntries(bd.buckets.map((b) => [b.key, b.amount])) as Record<ProfitBucketKey, Fig>;
      bSales = bd.sales;
      bIncome = bd.income;
      bProfit = bd.profit;
    }
    if (budgetRefusal) {
      const r = { refused: budgetRefusal };
      bBuckets = { fabric: r, process: r, trims: r, cmt_overheads: r };
      bSales = bIncome = bProfit = r;
    }

    // ---- ACTUALS ----
    const buckets = EMPTY_BUCKETS();
    const documents: ProfitDocument[] = [];

    // Purchase — one document entry per PO × bucket.
    const perPo = new Map<string, { bucket: "fabric" | "trims"; committed: number; actual: number }>();
    let skippedFx = 0;
    for (const l of poLines) {
      if (l.sales_order_id !== soId) continue;
      const po = pos.get(l.purchase_order_id);
      if (!po || !PO_ISSUED.has(po.status ?? "")) continue;
      // A foreign PO's line prices are in its foreign currency; no rate = no INR value.
      const foreign = !!po.foreign_currency_code && po.foreign_currency_code.toUpperCase() !== "INR";
      const fx = foreign ? num(po.exchange_rate) : 1;
      if (foreign && fx <= 0) {
        skippedFx += 1;
        continue;
      }
      const rate = l.is_foc ? 0 : num(l.net_rate) > 0 ? num(l.net_rate) : num(l.unit_price);
      const bucket = purchaseBucketOf(itemClass.get(l.item_id ?? "") ?? l.item_class);
      const key = `${po.id}|${bucket}`;
      const prev = perPo.get(key) ?? { bucket, committed: 0, actual: 0 };
      prev.committed += num(l.quantity) * rate * fx;
      prev.actual += (acceptedByLine.get(l.id) ?? 0) * rate * fx;
      perPo.set(key, prev);
    }
    if (skippedFx) notes.push(`${skippedFx} purchase line(s) in a foreign currency have no exchange rate on their PO, so they are left out.`);
    for (const [key, v] of perPo) {
      addTo(buckets, v.bucket, v.committed, v.actual, 1);
      documents.push({ kind: "Purchase order", code: pos.get(key.split("|")[0])?.code ?? null, bucket: v.bucket, committed: v.committed, actual: v.actual });
    }

    // Process orders.
    for (const p of procs) {
      if (p.sales_order_id !== soId) continue;
      if (p.currency_code && p.currency_code.toUpperCase() !== "INR") {
        notes.push(`Process order ${p.code ?? ""} is in ${p.currency_code} and carries no exchange rate, so it is left out.`);
        continue;
      }
      let committed = 0;
      let actual = 0;
      for (const pl of procLines) {
        if (pl.process_order_id !== p.id) continue;
        committed += num(pl.sent_qty) * num(pl.rate);
        actual += num(pl.received_qty) * num(pl.rate);
      }
      addTo(buckets, "process", committed, actual, 1);
      documents.push({ kind: "Process order", code: p.code, bucket: "process", committed, actual });
    }

    // Hand-entered heads.
    const manual = manualBySo.get(soId) ?? [];
    let income: number | null = null;
    for (const m of manual) {
      if (m.bucket === "income") income = (income ?? 0) + num(m.amount_inr);
      else addTo(buckets, "cmt_overheads", null, num(m.amount_inr), 1);
      documents.push({ kind: "Entered by hand", code: m.description, bucket: m.bucket, committed: null, actual: num(m.amount_inr) });
    }

    // Sales — shipped value in INR.
    type SalesActual = { amount: number; qty: number; docs: number };
    let sales = null as SalesActual | null;
    const perShip = new Map<string, { qty: number; amount: number }>();
    for (const sl of shipLines) {
      if (sl.sales_order_id !== soId) continue;
      const sh = ships.get(sl.shipment_id);
      if (!sh || !SHIPPED.has(sh.status ?? "")) continue;
      const prev = perShip.get(sh.id) ?? { qty: 0, amount: 0 };
      prev.qty += num(sl.quantity);
      prev.amount += num(sl.amount);
      perShip.set(sh.id, prev);
    }
    for (const [shipId, v] of perShip) {
      const sh = ships.get(shipId)!;
      const foreign = !!sh.currency_code && sh.currency_code.toUpperCase() !== "INR";
      const fx = foreign ? num(facts?.ex_rate) : 1;
      if (fx <= 0) {
        notes.push(`Shipment ${sh.code ?? ""} is in ${sh.currency_code} and the order has no exchange rate, so its value is left out.`);
        continue;
      }
      sales = { amount: (sales?.amount ?? 0) + v.amount * fx, qty: (sales?.qty ?? 0) + v.qty, docs: (sales?.docs ?? 0) + 1 };
      documents.push({ kind: "Shipment", code: sh.code, bucket: "sales", committed: null, actual: v.amount * fx });
    }

    const statement = compareProfitability({
      budget: { buckets: bBuckets, sales: bSales, income: bIncome, profit: bProfit },
      actual: { buckets, sales, income },
    });

    const so = soById.get(soId);
    rows.push({
      salesOrderId: soId,
      reNo: so?.order_number ?? facts?.re_no ?? null,
      customer: facts?.customer_name ?? null,
      merchandiser: doc.merchandiser_id ? empName.get(doc.merchandiser_id) ?? null : null,
      orderQty: facts?.qty ?? null,
      shippedQty: sales?.qty ?? 0,
      status: so?.status ?? null,
      completedOn: completedOn.get(soId) ?? null,
      budgetId: budget.id,
      budgetCode: budget.code,
      budgetRefusal,
      statement,
      documents,
      notes,
      created_at: facts?.created_at ?? doc.created_at,
      created_by: facts?.created_by ?? null,
    });
  }

  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return withCreators(rows);
}

/** The hand-entered rows of one order, for its entry grid. */
export async function listManualCosts(sb: SB, salesOrderId: string): Promise<ManualCostRow[]> {
  const { data, error } = await sb
    .from("order_actual_costs")
    .select("id, bucket, description, amount_inr, remarks")
    .eq("sales_order_id", salesOrderId)
    .order("created_at", { ascending: true });
  fail("Hand-entered costs", error);
  return ((data ?? []) as ManualCostRow[]).map((r) => ({ ...r, amount_inr: num(r.amount_inr) }));
}

