import type { JournalLineInput } from "./types";

/** Round to 2 decimals (currency). */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- aging ----------
export const AGING_BUCKETS = [
  "current",
  "1-30",
  "31-60",
  "61-90",
  "90+",
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Days overdue → bucket. Not-yet-due (or no due date) = "current". */
export function agingBucket(
  dueDate: string | null,
  asOf: Date = new Date(),
): AgingBucket {
  if (!dueDate) return "current";
  const due = new Date(dueDate + "T00:00:00");
  const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/** Sum outstanding amounts into aging buckets. */
export function summariseAging(
  items: { dueDate: string | null; outstanding: number }[],
  asOf: Date = new Date(),
): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const i of items) {
    out[agingBucket(i.dueDate, asOf)] += i.outstanding;
  }
  return out;
}

// ---------- forex ----------
export function forexToInr(amountFc: number, rate: number): number {
  return money(amountFc * rate);
}

// ---------- outstanding balances ----------
export function payableOutstanding(
  p: { total_amount: number; paid_amount: number },
): number {
  return money(Math.max(0, p.total_amount - p.paid_amount));
}

export function receivableOutstandingFc(
  r: { amount_fc: number; received_fc: number },
): number {
  return money(Math.max(0, r.amount_fc - r.received_fc));
}

// ---------- 3-way match (PO ↔ GRN ↔ invoice) ----------
/**
 * Compare the bill amount against the PO value and GRN-received value.
 * `matched` when all three agree within tolerance; `exception` otherwise.
 * Pass null for a leg that isn't linked → can't fully match → unmatched.
 */
export function threeWayMatchStatus(
  billAmount: number,
  poAmount: number | null,
  grnValue: number | null,
  tolerance = 0.01,
): "unmatched" | "matched" | "exception" {
  if (poAmount == null || grnValue == null) return "unmatched";
  const within = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(tolerance, Math.abs(b) * tolerance);
  return within(billAmount, poAmount) && within(billAmount, grnValue)
    ? "matched"
    : "exception";
}

// ---------- journals ----------
export function journalTotals(lines: Pick<JournalLineInput, "debit" | "credit">[]) {
  const totalDebit = money(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = money(lines.reduce((s, l) => s + (l.credit || 0), 0));
  return { totalDebit, totalCredit };
}

export function isJournalBalanced(
  lines: Pick<JournalLineInput, "debit" | "credit">[],
): boolean {
  const { totalDebit, totalCredit } = journalTotals(lines);
  return totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;
}

// ---------- shipment P&L ----------
export interface ShipmentPnl {
  revenue: number;
  totalCost: number;
  profit: number;
  marginPct: number;
}

export function shipmentPnl(
  revenue: number,
  costs: { amount: number }[],
): ShipmentPnl {
  const totalCost = money(costs.reduce((s, c) => s + c.amount, 0));
  const profit = money(revenue - totalCost);
  const marginPct = revenue > 0 ? money((profit / revenue) * 100) : 0;
  return { revenue: money(revenue), totalCost, profit, marginPct };
}
