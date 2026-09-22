/**
 * Budget approval, lock and Amendment Protocol — the words and figures that
 * travel with a budget once it leaves the merchandiser's hands.
 *
 * `doc/order/budget.md` §4, in the client's order:
 *
 *   1. Submitting sends the MD a summary: RE No, Entry Date, Delivery Date,
 *      Order Qty, Total Income, Total Expenses, Profit, Profit %, Cost per Piece.
 *   2. Approval LOCKS Order Entry, Fabric PLM and Material PLM for that RE No.
 *   3. A change after approval goes through an Amendment Protocol — who asked
 *      (By Customer / By Us), what kind of change, and a mandatory reason —
 *      "while keeping an audit log against the original approved budget
 *      baseline".
 *
 * ## NOTHING HERE COMPUTES A FIGURE
 *
 * Every number below is one `budgetTotals` / `generalSummary` already
 * produced; this file only picks them out, words them and freezes them. A
 * second profit calculation for the MD's phone would be a second answer to the
 * question the approval is about, and the two would part company the first
 * time one of them learned a rule the other did not. The one sum here — Total
 * Income = Gross Sales + Other Incomes — is the doc's own definition (§3 C),
 * and a vector pins it against `profit` so it cannot drift from the total it
 * is a part of.
 *
 * ## A REFUSAL IS STORED AS A REFUSAL
 *
 * The summary is stored when the budget is submitted (what the MD approved
 * against) and frozen again at a reopen (the baseline). If Profit could not be
 * worked out, the stored record must say so in words — not hold a 0, which
 * would read later as "approved at break-even". `Refusal` is already the plain
 * object `{ refused }`, so it survives JSON as itself, and the readers below
 * treat anything that is neither a number nor a refusal as "not recorded"
 * rather than trusting it.
 *
 * Client-safe (no `server-only`): the screen shows the summary before submit,
 * and the server stores what these same functions produce.
 */

import { money } from "@/lib/finance/calc";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { INITIATED_OPTIONS } from "@/lib/orders/amendments/types";
import {
  isRefusal,
  type BudgetTotals,
  type GeneralCategoryKey,
  type GeneralSummary,
  type Refusal,
  type SalesSummary,
} from "./totals";

// ---------------------------------------------------------------------------
// Amendment Protocol vocabulary
// ---------------------------------------------------------------------------

/**
 * Who asked for the change. The LABELS are the order module's own
 * `INITIATED_OPTIONS`, imported rather than retyped: an operator who picks
 * "By Customer" on an order amendment must see the same two words here, and a
 * copy is identical only until someone edits one of them. The stored VALUES
 * are short codes, since `order_budget_revisions.source` has a CHECK on them.
 */
export const AMENDMENT_SOURCES = [
  { value: "customer", label: INITIATED_OPTIONS[0] },
  { value: "internal", label: INITIATED_OPTIONS[1] },
] as const;
export type AmendmentSource = (typeof AMENDMENT_SOURCES)[number]["value"];

/**
 * What kind of change. The first eight are the legacy `order_amendments`
 * CHECK (0006) word for word — the list this business already amends orders
 * by. `internal_error` is the doc's own case (§4.4: "or an internal error
 * occurs"), and `other` exists so a change nobody foresaw can still be
 * recorded; the mandatory reason is what explains it.
 */
export const AMENDMENT_TYPES = [
  { value: "quantity", label: "Quantity" },
  { value: "colour", label: "Colour" },
  { value: "price", label: "Price" },
  { value: "sizes", label: "Sizes" },
  { value: "delivery_date", label: "Delivery Date" },
  { value: "consignee", label: "Consignee" },
  { value: "packing", label: "Packing" },
  { value: "style", label: "Style" },
  { value: "internal_error", label: "Internal Error" },
  { value: "other", label: "Other" },
] as const;
export type AmendmentType = (typeof AMENDMENT_TYPES)[number]["value"];

// ---------------------------------------------------------------------------
// The lock message
// ---------------------------------------------------------------------------

/** The business's own time zone. `approved_at` is an instant; the calendar
 *  day it fell on is an Indian one. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The IST calendar date of a timestamp, as "YYYY-MM-DD" — or the value as it
 * came when it is already a bare date.
 *
 * Why not `fmtDate(approvedAt)` directly: `fmtDate` puts a timestamp through
 * `new Date()` and reads it in the RUNTIME's zone. The same approval then
 * prints as one day in the browser (IST) and the day before on a UTC server
 * for anything approved between midnight and 05:30 — and the SQL trigger,
 * which carries this exact sentence, would be a third opinion. Pinning the
 * day to IST here, and `at time zone 'Asia/Kolkata'` in the trigger, makes all
 * three say the same thing. `fmtDate` still does the formatting.
 */
function istDay(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return v;
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Why a locked order refuses an edit — ONE sentence, and the SQL trigger
 * (`refuse_when_order_locked` via `order_lock_message`, 0604) raises the same
 * words. The spec's own headline (doc/order/amendment.md §1), sentence case:
 *
 *   Selected budget has been approved — RE <no>, budget <code>, approved on
 *   <dd/mm/yyyy>. Direct edits are disabled. Please use Garment Order Amendment.
 *
 * It names the way out, and the way out is now a door the merchandiser can
 * open (Orders ▸ Order Amendments) rather than the approver's Reopen. The RE
 * No and the date stay: the operator reading this has several orders open.
 * Fallbacks, each of which the trigger mirrors (a blank counts as missing):
 *
 *   - no RE No, no code, no date → "Selected budget has been approved. Direct…"
 *   - budget codes are not generated today, so "budget <code>" is usually absent
 *   - the first present fact follows " — ", the rest follow ", "
 */
export function orderLockMessage(v: {
  reNo: string | null;
  budgetCode: string | null;
  approvedAt: string | null;
}): string {
  const reNo = (v.reNo ?? "").trim();
  const code = (v.budgetCode ?? "").trim();
  const at = (v.approvedAt ?? "").trim();

  const facts: string[] = [];
  if (reNo) facts.push(`RE ${reNo}`);
  if (code) facts.push(`budget ${code}`);
  if (at) facts.push(`approved on ${fmtDate(istDay(at))}`);
  const tail = facts.length > 0 ? ` — ${facts.join(", ")}` : "";
  return `Selected budget has been approved${tail}. Direct edits are disabled. Please use Garment Order Amendment.`;
}

// ---------------------------------------------------------------------------
// The submission summary (§4.2)
// ---------------------------------------------------------------------------

/** What each order contributes to the summary that the totals do not carry. */
export type KpiOrder = { re_no: string | null; delivery_date: string | null };

export type BudgetKpis = {
  /** Distinct, in the budget's order. An order with no RE No adds nothing. */
  re_nos: string[];
  /** The budget's own entry date (ISO), not an order's. */
  entry_date: string | null;
  /** Distinct delivery dates, earliest first (ISO). */
  delivery_dates: string[];
  /** ORDER qty — pieces sold, the bottom bar's figure. */
  order_qty: number | Refusal;
  order_unit: string | Refusal;
  /** Gross Sales + Other Incomes (§3 C). */
  total_income: number | Refusal;
  /** The General matrix total — every cost line. */
  total_expenses: number | Refusal;
  profit: number | Refusal;
  profit_pct: number | Refusal;
  /** Cost per piece MADE (SQ Qty). */
  cost_per_piece: number | Refusal;
};

/**
 * The §4.2 summary, from figures already produced.
 *
 * Every money figure is read off `general` (which is itself `budgetTotals`
 * regrouped) and the quantity off the bottom bar's `salesSummary` — so the
 * summary the MD approves is, figure for figure, what the operator saw.
 *
 * `total_income` refuses if EITHER half does: gross sales without the other
 * incomes, or the other way round, is the partial sum this module exists to
 * prevent.
 */
export function budgetKpis(v: {
  entryDate: string | null;
  orders: readonly KpiOrder[];
  sales: SalesSummary;
  totals: BudgetTotals;
  general: GeneralSummary;
}): BudgetKpis {
  const re_nos: string[] = [];
  for (const o of v.orders) {
    const r = (o.re_no ?? "").trim();
    if (r && !re_nos.includes(r)) re_nos.push(r);
  }
  const delivery_dates = [
    ...new Set(v.orders.map((o) => (o.delivery_date ?? "").trim()).filter((d) => d !== "")),
  ].sort();

  const { general } = v;
  const total_income: number | Refusal = isRefusal(general.sales)
    ? general.sales
    : isRefusal(general.income)
      ? general.income
      : money(general.sales + general.income);

  return {
    re_nos,
    entry_date: v.entryDate ?? null,
    delivery_dates,
    order_qty: v.sales.qty,
    order_unit: v.sales.unit,
    total_income,
    total_expenses: general.total.amount,
    profit: general.profit,
    profit_pct: general.marginPct,
    cost_per_piece: general.costPerPiece,
  };
}

/** A stored figure read back: a number, a refusal, or "not recorded". */
function figure(v: unknown): number | Refusal {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isRefusal(v)) return { refused: v.refused };
  return { refused: "Not recorded" };
}

function text(v: unknown): string | Refusal {
  if (typeof v === "string") return v;
  if (isRefusal(v)) return { refused: v.refused };
  return { refused: "Not recorded" };
}

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The KPIs as stored in `submitted_summary` / a baseline. `v` versions the
 *  shape so a later change can still read what was approved before it. */
export type BudgetKpisJson = BudgetKpis & { v: 1 };

/**
 * JSON-safe copy for storage. A Refusal is already `{ refused }`, so nothing
 * is converted — this exists to stamp the version and to copy only the known
 * fields, so nothing the caller happened to attach is frozen with them.
 */
export function kpisToJson(k: BudgetKpis): BudgetKpisJson {
  const fig = (x: number | Refusal) => (isRefusal(x) ? { refused: x.refused } : x);
  return {
    v: 1,
    re_nos: [...k.re_nos],
    entry_date: k.entry_date,
    delivery_dates: [...k.delivery_dates],
    order_qty: fig(k.order_qty),
    order_unit: isRefusal(k.order_unit) ? { refused: k.order_unit.refused } : k.order_unit,
    total_income: fig(k.total_income),
    total_expenses: fig(k.total_expenses),
    profit: fig(k.profit),
    profit_pct: fig(k.profit_pct),
    cost_per_piece: fig(k.cost_per_piece),
  };
}

/**
 * Read a stored summary back. `jsonb` is whatever was written, by whichever
 * version of this file — so every field is checked, and one that is neither a
 * number nor a refusal reads as "Not recorded", never as 0. Null when the
 * value is not a summary at all.
 */
export function kpisFromJson(json: unknown): BudgetKpis | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  return {
    re_nos: strings(j.re_nos),
    entry_date: typeof j.entry_date === "string" ? j.entry_date : null,
    delivery_dates: strings(j.delivery_dates),
    order_qty: figure(j.order_qty),
    order_unit: text(j.order_unit),
    total_income: figure(j.total_income),
    total_expenses: figure(j.total_expenses),
    profit: figure(j.profit),
    profit_pct: figure(j.profit_pct),
    cost_per_piece: figure(j.cost_per_piece),
  };
}

// ---------------------------------------------------------------------------
// The phone notification
// ---------------------------------------------------------------------------

const unknown = (r: Refusal) => `unknown (${r.refused})`;
const rs = (x: number | Refusal) => (isRefusal(x) ? unknown(x) : fmtMoney(x));

/**
 * The approval push's body — plain text, four short lines, the §4.2 fields in
 * the doc's order, numbers in the app's own formats (`fmtMoney`, `fmtNumber`,
 * `fmtDate`).
 *
 * A refused figure says so in words, with its reason: "Profit unknown (SC-2:
 * two prices for one style)". An MD approving from a phone must never see a
 * blank where the margin should be and read it as zero. When Profit itself is
 * unknown its reason is given once, not repeated for the margin.
 */
export function kpiNotificationBody(k: BudgetKpis): string {
  const re = k.re_nos.length > 0 ? k.re_nos.join(", ") : "—";
  const delivery = k.delivery_dates.length > 0 ? k.delivery_dates.map(fmtDate).join(", ") : "—";
  const qty = isRefusal(k.order_qty)
    ? unknown(k.order_qty)
    : `${fmtNumber(k.order_qty)}${isRefusal(k.order_unit) ? "" : ` ${k.order_unit}`}`;

  // An unknown profit has no margin worth a second sentence; a known one shows
  // its margin, or says why there isn't one (zero sales).
  const profit = isRefusal(k.profit)
    ? unknown(k.profit)
    : isRefusal(k.profit_pct)
      ? `${fmtMoney(k.profit)} (margin ${unknown(k.profit_pct)})`
      : `${fmtMoney(k.profit)} (${fmtNumber(k.profit_pct)}%)`;

  return [
    `RE ${re} · Entry ${fmtDate(k.entry_date)} · Delivery ${delivery}`,
    `Order Qty ${qty}`,
    `Income ${rs(k.total_income)} · Expenses ${rs(k.total_expenses)}`,
    `Profit ${profit} · Cost/pc ${rs(k.cost_per_piece)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The approved baseline, and what has moved since (§4.4)
// ---------------------------------------------------------------------------

/**
 * What a reopen freezes: the approved summary, the General matrix as it
 * stood, and the approved lines. Written ONCE per revision, into
 * `order_budget_revisions.baseline`, before the budget goes back to draft —
 * so the audit log compares against what was approved, not against what the
 * budget says now.
 */
export type BudgetBaseline<L = unknown> = {
  v: 1;
  kpis: BudgetKpisJson;
  general: GeneralSummary;
  lines: L[];
};

export function budgetBaseline<L>(v: {
  kpis: BudgetKpis;
  general: GeneralSummary;
  lines: readonly L[];
}): BudgetBaseline<L> {
  /* A deep, plain copy: the baseline must not share objects with live state
     that goes on being edited after the reopen. GeneralSummary and a budget
     line are plain data (numbers, strings, refusal objects), so a JSON round
     trip is exact for them. */
  return {
    v: 1,
    kpis: kpisToJson(v.kpis),
    general: JSON.parse(JSON.stringify(v.general)) as GeneralSummary,
    lines: JSON.parse(JSON.stringify(v.lines)) as L[],
  };
}

export type BaselineRow = {
  key: GeneralCategoryKey | "total" | "sales" | "income" | "profit" | "margin" | "cost_per_piece";
  label: string;
  /** How to format it: money, or a percentage. */
  kind: "amount" | "percent";
  baseline: number | Refusal;
  current: number | Refusal;
  /** current − baseline. Refuses when either side does. */
  variance: number | Refusal;
};

/**
 * Approved baseline vs Current, row by row: each General category, then the
 * total and the bottom line.
 *
 * A VARIANCE AGAINST AN UNKNOWN IS NOT A VARIANCE. If either side refused,
 * there is no difference to report — printing the other side as the variance
 * (current − nothing) would show the whole figure as "the change". The
 * refusal names which side and why.
 *
 * The baseline is read the way `kpisFromJson` reads a summary: it came out of
 * jsonb, so a field that is not a number or a refusal is "Not recorded".
 */
export function compareToBaseline(
  baseline: Pick<BudgetBaseline, "general">,
  current: GeneralSummary,
): BaselineRow[] {
  const b = (baseline.general ?? {}) as Partial<GeneralSummary>;
  const bRows = Array.isArray(b.rows) ? b.rows : [];

  const row = (
    key: BaselineRow["key"],
    label: string,
    kind: BaselineRow["kind"],
    was: unknown,
    now: number | Refusal,
  ): BaselineRow => {
    const before = figure(was);
    const variance: number | Refusal = isRefusal(before)
      ? { refused: `Approved figure unknown — ${before.refused}` }
      : isRefusal(now)
        ? { refused: `Current figure unknown — ${now.refused}` }
        : money(now - before);
    return { key, label, kind, baseline: before, current: now, variance };
  };

  const rows = current.rows.map((c) =>
    row(c.key, c.label, "amount", bRows.find((x) => x?.key === c.key)?.amount, c.amount),
  );
  return [
    ...rows,
    row("total", "Total Expenses", "amount", b.total?.amount, current.total.amount),
    row("sales", "Gross Sales", "amount", b.sales, current.sales),
    row("income", "Other Incomes", "amount", b.income, current.income),
    row("profit", "Profit", "amount", b.profit, current.profit),
    row("margin", "Profit %", "percent", b.marginPct, current.marginPct),
    row("cost_per_piece", "Cost per Piece", "amount", b.costPerPiece, current.costPerPiece),
  ];
}
