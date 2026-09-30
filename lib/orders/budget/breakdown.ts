import {
  isRefusal,
  suppressedRefusal,
  type BudgetSource,
  type BudgetTotals,
  type GeneralCategoryKey,
  type Refusal,
} from "./totals";
import type { BaselineRow } from "./amendment";

/**
 * THE APPROVAL CHART'S FIVE BUCKETS (client 2026-09-29, "Budget Chart in
 * Approval View"), in garment costing's words:
 *
 *   Fabric              = Yarn + Fabric purchases (greige or dyed cloth bought)
 *   Process             = the FABRIC's job-work (knitting, dyeing, compacting,
 *                         washing, printing) + yarn, accessory and garment
 *                         processing
 *   Trims & Accessories = accessory purchases
 *   CMT & Overheads     = CMT + other expenses
 *   Net Profit          = profit, as the budget's own engine states it
 *
 * BY SOURCE, NOT BY THE GENERAL TAB — AND THAT IS THE DIFFERENCE BETWEEN THEM.
 * The General tab counts the fabric's job-work under FABRIC (2026-09-24,
 * `GENERAL_CATEGORIES`: an in-house fabric raises no fabric line, so its
 * Fabric row read 0). The client's chart spec puts knitting, dyeing and
 * compacting under PROCESS, twice over (2026-09-29). The first cut of this
 * file regrouped the General tab and so drew them as Fabric — 33% Fabric on
 * budget 3 where the spec's own grouping gives 26%. So the current budget is
 * bucketed from `costBySource` directly, and V0 — which is stored only as
 * General categories — has its fabric job-work split back out of Fabric from
 * the baseline's own frozen lines (`fabricProcessAmountOf`).
 *
 * `BUCKET_OF_SOURCE` and `BUCKET_OF_CATEGORY` are `Record`s over every source
 * and every category, so either growing a member is a type error here until
 * it is given a bucket — nothing can silently drop out of the chart while
 * still counting in the budget's total.
 */
export type BreakdownBucketKey = "fabric" | "process" | "trims" | "cmt_overheads";

type CostSource = Exclude<BudgetSource, "income">;

const BUCKET_OF_SOURCE: Record<CostSource, BreakdownBucketKey> = {
  yarn: "fabric",
  fabric: "fabric",
  fabric_process: "process",
  yarn_process: "process",
  material_process: "process",
  garment_process: "process",
  material: "trims",
  cmt: "cmt_overheads",
  expense: "cmt_overheads",
};

/** V0's categories → buckets. `fabric` holds `fabric_process` too (grouping 2,
 *  and `compareToBaseline` regroups an older baseline the same way), so it is
 *  "fabric" LESS the job-work, which is added to "process" — see below. */
const BUCKET_OF_CATEGORY: Record<GeneralCategoryKey, BreakdownBucketKey> = {
  yarn: "fabric",
  fabric: "fabric",
  processing: "process",
  accessories: "trims",
  cmt: "cmt_overheads",
  other: "cmt_overheads",
};

export const BREAKDOWN_BUCKETS: readonly { key: BreakdownBucketKey; label: string }[] = [
  { key: "fabric", label: "Fabric" },
  { key: "process", label: "Process" },
  { key: "trims", label: "Trims & Accessories" },
  { key: "cmt_overheads", label: "CMT & Overheads" },
];

/** The chart group a budget source rolls into, by its label ("Process" for
 *  Fabric Processing) — so a per-line table can say which slice of the ring
 *  each line is part of. Null for `income`, which is not a cost. */
export function bucketLabelOfSource(source: BudgetSource): string | null {
  if (source === "income") return null;
  const key = BUCKET_OF_SOURCE[source];
  return BREAKDOWN_BUCKETS.find((b) => b.key === key)?.label ?? null;
}

type Fig = number | Refusal;

export type BudgetBreakdown = {
  /** Gross sales — the base every percentage here is taken of, as on the
   *  General tab ("% of Gross Sales"). */
  sales: Fig;
  buckets: { key: BreakdownBucketKey; label: string; amount: Fig; pct: Fig }[];
  /** Other incomes, which profit includes (`profit = sales + income − cost`). */
  income: Fig;
  profit: Fig;
  /** Profit as % of sales — the budget's own margin, never recomputed here. */
  profitPct: Fig;
};

const money = (n: number) => Math.round(n * 100) / 100;

/** A share of sales, or why there is none — the General tab's `pctOf` rule. */
function pctOf(amount: Fig, sales: Fig): Fig {
  if (isRefusal(sales)) return sales;
  if (isRefusal(amount)) return amount;
  if (sales <= 0) return { refused: "No sales value to measure against" };
  return money((amount / sales) * 100);
}

/** One figure from jsonb that may not be a number — "Not recorded" then. */
function fig(v: unknown): Fig {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isRefusal(v as Fig)) return v as Refusal;
  return { refused: "Not recorded" };
}

/** Sum `parts` into their buckets. A bucket refuses when any part in it does,
 *  with that part's reason — `generalSummary`'s rule for its sources. */
function bucketsOf(parts: { bucket: BreakdownBucketKey; amount: Fig }[], sales: Fig) {
  return BREAKDOWN_BUCKETS.map((b) => {
    let amount: Fig = 0;
    for (const p of parts) {
      if (p.bucket !== b.key) continue;
      if (isRefusal(p.amount)) {
        amount = p.amount;
        break;
      }
      amount = money(amount + p.amount);
    }
    return { ...b, amount, pct: pctOf(amount, sales) };
  });
}

/**
 * The current budget, from its engine totals. Profit and margin carry the
 * SHORT suppression ("Suppressed — N rates missing"), as the General tab and
 * the summary bar print them.
 */
export function breakdownOfTotals(totals: BudgetTotals): BudgetBreakdown {
  const parts = (Object.keys(BUCKET_OF_SOURCE) as CostSource[]).map((s) => ({
    bucket: BUCKET_OF_SOURCE[s],
    amount: totals.costBySource[s],
  }));
  return {
    sales: totals.sales,
    buckets: bucketsOf(parts, totals.sales),
    income: totals.income,
    profit: suppressedRefusal(totals.profit, totals),
    profitPct: suppressedRefusal(totals.profitPct, totals),
  };
}

/**
 * V0, from `compareToBaseline`'s BASELINE side (keyed as
 * `RevisionComparisonData.original` holds it — regrouped, so an old baseline
 * reads the same as a new one), plus that baseline's fabric job-work from its
 * frozen lines (`fabricProcessAmountOf`), which moves from Fabric to Process.
 */
export function breakdownOfBaseline(
  original: Partial<Record<BaselineRow["key"], Fig>>,
  fabricProcess: Fig,
): BudgetBreakdown {
  const at = (k: BaselineRow["key"]) => fig(original[k]);
  const sales = at("sales");
  const neg = (f: Fig): Fig => (isRefusal(f) ? f : -f);
  const parts = [
    ...(Object.keys(BUCKET_OF_CATEGORY) as GeneralCategoryKey[]).map((c) => ({
      bucket: BUCKET_OF_CATEGORY[c],
      amount: at(c),
    })),
    { bucket: "fabric" as const, amount: neg(fabricProcess) },
    { bucket: "process" as const, amount: fabricProcess },
  ];
  return {
    sales,
    buckets: bucketsOf(parts, sales),
    income: at("income"),
    profit: at("profit"),
    profitPct: at("margin"),
  };
}

/** `compareToBaseline`'s rows as that record — the shape `getRevisionComparison` returns. */
export function baselineRecordOf(rows: readonly BaselineRow[]): Partial<Record<BaselineRow["key"], Fig>> {
  return Object.fromEntries(rows.map((r) => [r.key, r.baseline]));
}

// ---------------------------------------------------------------------------
// The approval card's figures per piece (client 2026-09-29, "MD Approval
// Screen in Mobile View": the variance matrix is in ₹ per piece)
// ---------------------------------------------------------------------------

/**
 * THE MARGIN LINE (client 2026-09-29): Net Profit Margin reads GREEN at or
 * above this and AMBER below it — always with the words beside the colour.
 * A fixed rule for now (user 2026-09-29, "go with your recommendations"); a
 * setting the MD can change is a later ask, and this is the one place it lives.
 */
export const MARGIN_TARGET_PCT = 15;

/**
 * PER PIECE MEANS PER PIECE SOLD — the ORDER quantity (user 2026-09-29), the
 * pieces the buyer pays for. Not the Cut Qty the budget's own "Cost per Piece"
 * divides by: that spreads the cost of excess and rejection allowance over
 * pieces made, which answers a different question than "what does each piece
 * we sell cost us, and earn us".
 */
export function perPiece(amount: Fig, qty: Fig | null | undefined): Fig {
  if (isRefusal(amount)) return amount;
  if (qty == null) return { refused: "No order quantity" };
  if (isRefusal(qty)) return qty;
  if (!(qty > 0)) return { refused: "No order quantity" };
  return money(amount / qty);
}

export type VarianceRow = {
  key: BreakdownBucketKey | "total" | "margin";
  label: string;
  /** ₹ per piece (margin: % of sales). */
  v0: Fig;
  now: Fig;
  /** now − v0, or why there is none. */
  delta: Fig;
  kind: "cost" | "total" | "margin";
};

/**
 * V0 vs PROPOSED, row by row, per piece sold — the card's variance matrix.
 * Each side divides by ITS OWN order quantity (V0's frozen KPIs, the proposal's
 * submitted KPIs): a revision that adds quantity would otherwise show every
 * cost head "falling" per piece when nothing but the divisor moved.
 *
 * A DELTA AGAINST AN UNKNOWN IS NOT A DELTA — either side refusing refuses it,
 * the rule `compareToBaseline` states for the General tab.
 */
export function varianceRows(
  v0: BudgetBreakdown,
  now: BudgetBreakdown,
  v0Qty: Fig | null,
  nowQty: Fig | null,
): VarianceRow[] {
  const diff = (a: Fig, b: Fig): Fig =>
    isRefusal(a) ? a : isRefusal(b) ? b : money(b - a);
  const sum = (b: BudgetBreakdown): Fig => {
    let t: Fig = 0;
    for (const x of b.buckets) {
      if (isRefusal(x.amount)) return x.amount;
      t = money(t + x.amount);
    }
    return t;
  };
  const rows: VarianceRow[] = now.buckets.map((c) => {
    const was = perPiece(v0.buckets.find((o) => o.key === c.key)?.amount ?? { refused: "Not recorded" }, v0Qty);
    const is = perPiece(c.amount, nowQty);
    return { key: c.key, label: c.label, v0: was, now: is, delta: diff(was, is), kind: "cost" };
  });
  const tWas = perPiece(sum(v0), v0Qty);
  const tNow = perPiece(sum(now), nowQty);
  rows.push({ key: "total", label: "Total unit cost", v0: tWas, now: tNow, delta: diff(tWas, tNow), kind: "total" });
  rows.push({
    key: "margin",
    label: "Net profit margin",
    v0: v0.profitPct,
    now: now.profitPct,
    delta: diff(v0.profitPct, now.profitPct),
    kind: "margin",
  });
  return rows;
}
