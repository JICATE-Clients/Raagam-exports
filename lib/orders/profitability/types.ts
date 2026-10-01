/**
 * Order Profitability — budget vs actual (doc/order/digitalisation-plan.md §3).
 *
 * Client-safe and pure: the screen, the server service and
 * `scripts/check-profitability.mts` all read this one comparison.
 *
 * ## THE BUDGET SIDE IS NEVER RE-DERIVED HERE
 *
 * Budget figures arrive already bucketed by the budget module's own
 * `breakdownOfTotals` (`lib/orders/budget/breakdown.ts`) — Fabric · Process ·
 * Trims & Accessories · CMT & Overheads, the approval chart's buckets. This file
 * only lines actuals up beside them. A second copy of budget math is how the
 * Profitability screen and the approved budget would come to disagree.
 *
 * ## "NO DOCUMENTS YET" IS NOT ZERO
 *
 * Every actuals table was empty on 2026-10-01. An actual of 0 beside a budget of
 * ₹4,20,000 reads as "we saved the whole fabric cost" — believable and wrong. A
 * bucket nothing has been recorded against is `null`, printed "No documents
 * yet", and it makes ACTUAL PROFIT provisional rather than flattering.
 */

export type Refusal = { refused: string };
export type Fig = number | Refusal;

export const isRefused = (v: unknown): v is Refusal =>
  typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";

/** Same keys as `BreakdownBucketKey` — kept literal so this file stays pure. */
export type ProfitBucketKey = "fabric" | "process" | "trims" | "cmt_overheads";

export const PROFIT_BUCKETS: readonly { key: ProfitBucketKey; label: string; actualFrom: string }[] = [
  { key: "fabric", label: "Fabric", actualFrom: "Yarn and fabric purchase orders, valued at what was received" },
  { key: "process", label: "Process", actualFrom: "Process orders, valued at what came back" },
  { key: "trims", label: "Trims & Accessories", actualFrom: "Accessory purchase orders, valued at what was received" },
  { key: "cmt_overheads", label: "CMT & Overheads", actualFrom: "Entered by hand below — no document records it" },
];

/** A cost line more than this % over its budget is highlighted. */
export const OVER_BUDGET_PCT = 5;

/** Manual heads (0667 `order_actual_costs.bucket`). */
export const MANUAL_BUCKETS = ["cmt_overheads", "income"] as const;
export type ManualBucket = (typeof MANUAL_BUCKETS)[number];
export const MANUAL_BUCKET_LABELS: Record<ManualBucket, string> = {
  cmt_overheads: "Stitching / CMT",
  income: "Other income",
};

/** One bucket's actual, or null when no document has been recorded against it. */
export type BucketActual = {
  /** What was committed — PO / process-order value. Null for a manual head. */
  committed: number | null;
  /** What was received (or entered) — the figure compared with the budget. */
  actual: number;
  /** How many documents (or manual rows) fed it. */
  docs: number;
} | null;

export type ProfitInput = {
  budget: {
    buckets: Record<ProfitBucketKey, Fig>;
    sales: Fig;
    income: Fig;
    profit: Fig;
  };
  actual: {
    buckets: Record<ProfitBucketKey, BucketActual>;
    /** Shipped value (INR) and pieces, or null when nothing has shipped. */
    sales: { amount: number; qty: number; docs: number } | null;
    /** Hand-entered other income, or null when none entered. */
    income: number | null;
  };
};

export type StatementRow = {
  key: ProfitBucketKey | "sales" | "income" | "profit";
  label: string;
  budget: Fig;
  committed: number | null;
  /** null = "No documents yet". */
  actual: number | null;
  /** actual − budget; null when either side is missing. */
  diff: number | null;
  /** diff as % of the budget; null when the budget is 0 / missing. */
  diffPct: number | null;
  /** Cost over budget, or sales / profit under it, by more than OVER_BUDGET_PCT. */
  flagged: boolean;
};

export type ProfitStatement = {
  costs: StatementRow[];
  sales: StatementRow;
  income: StatementRow;
  profit: StatementRow;
  /** Profit as % of actual sales, or why not. */
  actualProfitPct: Fig;
  /** Cost buckets with no documents yet — the actual profit leaves them out,
   *  so it is provisional while this is non-empty. */
  missing: string[];
};

const money = (n: number) => Math.round(n * 100) / 100;
const pct1 = (n: number) => Math.round(n * 10) / 10;

function variance(budget: Fig, actual: number | null): { diff: number | null; diffPct: number | null } {
  if (actual == null || isRefused(budget)) return { diff: null, diffPct: null };
  const diff = money(actual - budget);
  const diffPct = budget !== 0 ? pct1((diff / Math.abs(budget)) * 100) : null;
  return { diff, diffPct };
}

/**
 * The statement. A COST is flagged when it runs over its budget by more than
 * OVER_BUDGET_PCT; SALES and PROFIT are flagged when they fall short by more
 * than that — the direction that costs the business money, each way.
 */
export function compareProfitability(input: ProfitInput): ProfitStatement {
  const costs: StatementRow[] = PROFIT_BUCKETS.map((b) => {
    const a = input.actual.buckets[b.key];
    const budget = input.budget.buckets[b.key];
    const actual = a ? money(a.actual) : null;
    const v = variance(budget, actual);
    return {
      key: b.key,
      label: b.label,
      budget,
      committed: a?.committed ?? null,
      actual,
      ...v,
      flagged: v.diffPct != null && v.diffPct > OVER_BUDGET_PCT,
    };
  });

  const salesActual = input.actual.sales ? money(input.actual.sales.amount) : null;
  const sv = variance(input.budget.sales, salesActual);
  const sales: StatementRow = {
    key: "sales",
    label: "Sales",
    budget: input.budget.sales,
    committed: null,
    actual: salesActual,
    ...sv,
    flagged: sv.diffPct != null && sv.diffPct < -OVER_BUDGET_PCT,
  };

  const iv = variance(input.budget.income, input.actual.income);
  const income: StatementRow = {
    key: "income",
    label: "Other Income",
    budget: input.budget.income,
    committed: null,
    actual: input.actual.income,
    ...iv,
    flagged: false,
  };

  const missing = costs.filter((c) => c.actual == null).map((c) => c.label);

  // ACTUAL PROFIT needs a sale. Before anything ships it is not "a loss of the
  // whole cost" — it is not known yet, and it says so.
  let profitActual: number | null = null;
  if (salesActual != null) {
    const cost = costs.reduce((s, c) => s + (c.actual ?? 0), 0);
    profitActual = money(salesActual + (input.actual.income ?? 0) - cost);
  }
  const pv = variance(input.budget.profit, profitActual);
  const profit: StatementRow = {
    key: "profit",
    label: "Profit",
    budget: input.budget.profit,
    committed: null,
    actual: profitActual,
    ...pv,
    // Profit under budget by more than the limit, measured against the budget's
    // own size — a 5 % miss on a ₹10,000 profit is ₹500, not 5 % of sales.
    flagged: pv.diffPct != null && pv.diffPct < -OVER_BUDGET_PCT,
  };

  const actualProfitPct: Fig =
    profitActual == null
      ? { refused: "Nothing shipped yet" }
      : salesActual && salesActual > 0
        ? pct1((profitActual / salesActual) * 100)
        : { refused: "No sales value to measure against" };

  return { costs, sales, income, profit, actualProfitPct, missing };
}

/** Item-class code → the bucket its purchase lands in. Yarn and fabric are
 *  Fabric (the budget's `yarn` + `fabric` sources); everything else bought
 *  for an order — sewing, packing, general — is Trims & Accessories. */
export function purchaseBucketOf(classCode: string | null | undefined): "fabric" | "trims" {
  const c = (classCode ?? "").trim().toUpperCase();
  return c === "YARN" || c === "FABRIC" ? "fabric" : "trims";
}

/** The order is closed (Order Closure ▸ Completion sets `sales_orders.status`). */
export const isClosedStatus = (status: string | null | undefined) => status === "closed";

// ---------------------------------------------------------------------------
// Rows the service returns (types live here so client components can read them)
// ---------------------------------------------------------------------------

export type ProfitDocument = {
  kind: "Purchase order" | "Process order" | "Shipment" | "Entered by hand";
  code: string | null;
  bucket: ProfitBucketKey | "sales" | "income";
  committed: number | null;
  actual: number;
};

export type ProfitOrderRow = {
  salesOrderId: string;
  reNo: string | null;
  customer: string | null;
  merchandiser: string | null;
  orderQty: number | null;
  shippedQty: number;
  /** `sales_orders.status` — "closed" once Order Closure ▸ Completion ran. */
  status: string | null;
  completedOn: string | null;
  budgetId: string;
  budgetCode: string | null;
  /** Why the budget side cannot be shown per order, or null. */
  budgetRefusal: string | null;
  statement: ProfitStatement;
  documents: ProfitDocument[];
  /** Sentences about what was skipped, and why. */
  notes: string[];
  /** The ORDER's provenance — every listing carries the pair (AGENTS.md). */
  created_at: string;
  created_by: string | null;
};

export type ManualCostRow = {
  id: string;
  bucket: ManualBucket;
  description: string;
  amount_inr: number;
  remarks: string | null;
};

/** Σ over rows, per bucket — the grouped totals (by buyer, by merchandiser).
 *  A refused budget profit leaves the group's budget total refused too: a sum
 *  that silently skipped an order is not the group's figure. */
export type ProfitGroup = { key: string; orders: number; budgetProfit: Fig; actualProfit: number | null; shippedOrders: number };

export function groupProfit(rows: ProfitOrderRow[], keyOf: (r: ProfitOrderRow) => string | null): ProfitGroup[] {
  const groups = new Map<string, ProfitGroup>();
  for (const r of rows) {
    const key = keyOf(r) ?? "—";
    const g = groups.get(key) ?? { key, orders: 0, budgetProfit: 0, actualProfit: null, shippedOrders: 0 };
    g.orders += 1;
    const bp = r.statement.profit.budget;
    if (isRefused(g.budgetProfit)) {
      /* stays refused */
    } else if (isRefused(bp)) {
      g.budgetProfit = { refused: `${r.reNo ?? "An order"}: ${bp.refused}` };
    } else {
      g.budgetProfit = g.budgetProfit + bp;
    }
    if (r.statement.profit.actual != null) {
      g.actualProfit = (g.actualProfit ?? 0) + r.statement.profit.actual;
      g.shippedOrders += 1;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
