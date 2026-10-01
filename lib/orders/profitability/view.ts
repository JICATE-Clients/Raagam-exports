/**
 * Budget vs Actual — the SCREEN's vocabulary over `ProfitOrderRow`
 * (doc/order/digitalisation-plan.md §3; layout approved 2026-10-01 as the
 * "Budget vs Actual Plan" artifact).
 *
 * Pure and client-safe. Nothing here re-derives budget math: every planned
 * figure is the statement's own `budget`, every "so far" figure its `actual`.
 * This file only regroups them for the Overview and words them plainly.
 *
 * ## PLAIN WORDS (client 2026-10-01: "label look not familiar")
 *
 * The statement's own labels (Fabric · Process · Trims & Accessories · CMT &
 * Overheads · Sales · Other Income) stay in types.ts for the engine; the screen
 * reads the words below. Planned / spent so far / money from buyer / saved /
 * overspent — never "variance", "head" or "income".
 */

import { isClosedStatus, isRefused, type Fig, type ProfitBucketKey, type ProfitOrderRow } from "./types";

export const PLAIN: Record<ProfitBucketKey, { label: string; hint: string }> = {
  fabric: { label: "Fabric & yarn", hint: "Yarn and fabric bought, at what was received" },
  process: { label: "Dyeing & processing", hint: "Knitting, dyeing, printing and washing done outside" },
  trims: { label: "Trims & packing", hint: "Buttons, labels, cartons and other accessories" },
  cmt_overheads: { label: "Stitching (CMT) & other costs", hint: "Typed in by hand on the order" },
};
export const COST_KEYS: ProfitBucketKey[] = ["fabric", "process", "trims", "cmt_overheads"];

/** Running orders whose spending is this many points ahead of their shipping are flagged. */
export const WATCH_POINTS = 25;

export type BvaStage = "done" | "run" | "none" | "cancelled";
export const STAGE_LABEL: Record<BvaStage, string> = {
  done: "Finished",
  run: "Running",
  none: "Not started",
  cancelled: "Cancelled",
};

const num = (f: Fig): number | null => (isRefused(f) ? null : f);

export type BvaCost = { key: ProfitBucketKey; label: string; hint: string; plan: number | null; spent: number | null; po: number | null };

export type BvaItem = {
  row: ProfitOrderRow;
  stage: BvaStage;
  planProfit: number | null;
  profit: number | null;
  /** profit − planProfit; null until both exist. */
  gap: number | null;
  planSales: number | null;
  sales: number | null;
  planIncome: number | null;
  income: number | null;
  planMargin: number | null;
  margin: number | null;
  planCost: number | null;
  spentCost: number | null;
  /** Spent as % of the planned cost. */
  spendPct: number | null;
  /** Shipped pieces as % of the order. */
  shipPct: number | null;
  costs: BvaCost[];
};

export function toBvaItem(row: ProfitOrderRow): BvaItem {
  const st = row.statement;
  const costs: BvaCost[] = COST_KEYS.map((k) => {
    const c = st.costs.find((x) => x.key === k);
    return { key: k, ...PLAIN[k], plan: c ? num(c.budget) : null, spent: c?.actual ?? null, po: c?.committed ?? null };
  });
  const anyActual = costs.some((c) => c.spent != null) || st.sales.actual != null;
  const stage: BvaStage = row.status === "cancelled" ? "cancelled" : isClosedStatus(row.status) ? "done" : anyActual ? "run" : "none";
  const planProfit = num(st.profit.budget);
  const profit = st.profit.actual;
  const planSales = num(st.sales.budget);
  const sales = st.sales.actual;
  const plans = costs.map((c) => c.plan);
  const planCost = plans.every((p) => p != null) ? plans.reduce((a: number, p) => a + (p ?? 0), 0) : null;
  const spentCost = costs.some((c) => c.spent != null) ? costs.reduce((a, c) => a + (c.spent ?? 0), 0) : null;
  return {
    row,
    stage,
    planProfit,
    profit,
    gap: planProfit != null && profit != null ? profit - planProfit : null,
    planSales,
    sales,
    planIncome: num(st.income.budget),
    income: st.income.actual,
    planMargin: planProfit != null && planSales ? (planProfit / planSales) * 100 : null,
    margin: typeof st.actualProfitPct === "number" ? st.actualProfitPct : null,
    planCost,
    spentCost,
    spendPct: planCost && spentCost != null ? (spentCost / planCost) * 100 : null,
    shipPct: row.orderQty ? (row.shippedQty / row.orderQty) * 100 : null,
    costs,
  };
}

/** An item the Overview can add up: finished, with both profits known. */
export const isComparable = (i: BvaItem): i is BvaItem & { planProfit: number; profit: number; gap: number } =>
  i.stage === "done" && i.planProfit != null && i.profit != null && i.gap != null;

export type BridgeStep = { key: string; label: string; value: number };

/**
 * Planned profit → each cause → actual profit, over finished orders.
 *
 * Exact by construction: actual profit = sales + income − Σ cost (the
 * statement's own rule), and planned = planned sales + planned income − Σ
 * planned cost, so the steps below always add up to the gap. A cost with no
 * documents counts as 0 spent there too — the order's profit is provisional
 * then, and the screen says so rather than hiding the step.
 */
export function bridge(items: BvaItem[]): { plan: number; actual: number; steps: BridgeStep[]; provisional: number } | null {
  const d = items.filter(isComparable);
  if (!d.length) return null;
  const steps: BridgeStep[] = COST_KEYS.map((k) => ({
    key: k,
    label: PLAIN[k].label,
    value: -d.reduce((a, i) => {
      const c = i.costs.find((x) => x.key === k)!;
      return a + ((c.spent ?? 0) - (c.plan ?? 0));
    }, 0),
  }));
  steps.push({ key: "sales", label: "Money from buyer", value: d.reduce((a, i) => a + ((i.sales ?? 0) - (i.planSales ?? 0)), 0) });
  const inc = d.reduce((a, i) => a + ((i.income ?? 0) - (i.planIncome ?? 0)), 0);
  if (Math.round(inc) !== 0) steps.push({ key: "income", label: "Other income", value: inc });
  return {
    plan: d.reduce((a, i) => a + i.planProfit, 0),
    actual: d.reduce((a, i) => a + i.profit, 0),
    steps,
    provisional: d.filter((i) => i.costs.some((c) => c.spent == null)).length,
  };
}

/** Each cost (and money from the buyer) as a % of its plan, over finished orders. */
export function meters(items: BvaItem[]) {
  const d = items.filter(isComparable);
  if (!d.length) return [];
  const rows = COST_KEYS.map((k) => {
    const plan = d.reduce((a, i) => a + (i.costs.find((c) => c.key === k)!.plan ?? 0), 0);
    const spent = d.reduce((a, i) => a + (i.costs.find((c) => c.key === k)!.spent ?? 0), 0);
    return { key: k as string, label: PLAIN[k].label, kind: "cost" as const, plan, actual: spent };
  });
  const ps = d.reduce((a, i) => a + (i.planSales ?? 0), 0);
  const ss = d.reduce((a, i) => a + (i.sales ?? 0), 0);
  return [...rows, { key: "sales", label: "Money from buyer", kind: "sales" as const, plan: ps, actual: ss }];
}

/** Running orders spending well ahead of their shipping — the early warning. */
export function watchList(items: BvaItem[]) {
  return items
    .filter((i) => i.stage === "run" && i.spendPct != null)
    .map((i) => ({ item: i, ahead: (i.spendPct ?? 0) - (i.shipPct ?? 0) }))
    .filter((x) => x.ahead > WATCH_POINTS)
    .sort((a, b) => b.ahead - a.ahead);
}

/** ₹ in Indian short form: ₹3.2 L, ₹45k. */
export function lakh(n: number): string {
  const a = Math.abs(n);
  const s = a >= 100000 ? `${(a / 100000).toFixed(1).replace(/\.0$/, "")} L` : a >= 1000 ? `${Math.round(a / 1000)}k` : String(Math.round(a));
  return `${n < 0 ? "−" : ""}₹${s}`;
}
/** ₹ in whole rupees, Indian grouping. */
export function rupees(n: number): string {
  return `${n < 0 ? "−" : ""}₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}

/** The order's result in a few words, for the list. */
export function resultOf(i: BvaItem): { tone: "good" | "bad" | "warn" | "info" | "none"; label: string; detail: string } {
  if (i.stage === "cancelled") return { tone: "none", label: "Cancelled", detail: "not counted" };
  if (i.stage === "none") return { tone: "none", label: "Not started", detail: "nothing bought or shipped yet" };
  if (i.stage === "run") {
    const ahead = (i.spendPct ?? 0) - (i.shipPct ?? 0);
    return ahead > WATCH_POINTS
      ? { tone: "warn", label: "Watch", detail: `spent ${Math.round(i.spendPct ?? 0)}%, shipped ${Math.round(i.shipPct ?? 0)}%` }
      : { tone: "info", label: "Running", detail: "in step with plan" };
  }
  if (i.gap == null) return { tone: "none", label: "Finished", detail: "result not known" };
  return i.gap >= 0
    ? { tone: "good", label: "Above plan", detail: `${lakh(i.gap)} more` }
    : { tone: "bad", label: "Below plan", detail: `${lakh(-i.gap)} less` };
}
