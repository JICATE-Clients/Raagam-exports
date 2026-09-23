/**
 * THE BUDGET UNDER AN AMENDMENT THAT DID NOT PICK "ORDER BUDGET" (0619).
 *
 * doc/order/amenment update.md §2 rule 1: the system unlocks edit
 * capabilities ONLY for the selected module screens. The Order Budget module
 * is "Overheads, Freight, Operational Rates" — so when an amendment raised for
 * Order Entry or a BOM sends the budget back to draft, the budget's OWN heads
 * stay as approved:
 *
 *   - the hand-typed sections (Expense — overheads, freight —, Income, CMT)
 *     cannot gain, lose or change a line;
 *   - a purchase or process line that carried a rate in the approved version
 *     keeps that rate (and its currency, exchange rate, rate type, FOC /
 *     import flags, pieces and units);
 *
 * WHAT STAYS OPEN, and why it must: the BOM-pulled quantities (the recalculated
 * figures — spec §3.1), and the RATE OF A LINE THE APPROVED VERSION DID NOT
 * PRICE. A new trim, a new fabric process or a new colourway's line arrives
 * with no rate; the spec's "Manual Entry Needed" banner sends the operator to
 * exactly that cell, and a lock there would make the amendment unfinishable.
 *
 * ONE FUNCTION, THREE READERS: the budget screen (which cells are read-only),
 * `updateOrderBudget` and `submitBudget` (the refusal). The budget is not
 * trigger-locked (its lines are delete-and-reinsert), so the action IS the
 * guard here, as `assertEditable` already is for the status.
 *
 * Client-safe: plain data in, a sentence out.
 */

export type BudgetScopeLine = {
  source: string;
  garment_order_id?: string | null;
  item_id?: string | null;
  process_id?: string | null;
  basis?: string | null;
  combo?: string | null;
  style_ref_no?: string | null;
  component_id?: string | null;
  cost_head_id?: string | null;
  stage_id?: string | null;
  description?: string | null;
  qty?: number | string | null;
  uom_id?: string | null;
  rate?: number | string | null;
  currency_code?: string | null;
  ex_rate?: number | string | null;
  rate_type?: string | null;
  is_foc?: boolean | null;
  is_import?: boolean | null;
  no_of_pcs?: number | string | null;
  no_of_units?: number | string | null;
  cutting_rate?: number | string | null;
  making_rate?: number | string | null;
  checking_rate?: number | string | null;
  ironing_rate?: number | string | null;
  packing_rate?: number | string | null;
  specification?: string | null;
  notes?: string | null;
};

/** The sections that ARE the Order Budget module — overheads, freight, operational rates. */
export const BUDGET_OWN_SOURCES = ["expense", "income", "cmt"] as const;

export function isOwnBudgetSource(source: string): boolean {
  return (BUDGET_OWN_SOURCES as readonly string[]).includes(source);
}

const SOURCE_WORD: Record<string, string> = {
  expense: "Expenses (overheads, freight)",
  income: "Other incomes",
  cmt: "CMT",
};

/** What a line IS — the tuple `copyLineOf` already treats as a line's identity. */
export function budgetLineKey(l: BudgetScopeLine): string {
  return [
    l.source,
    l.garment_order_id ?? "",
    l.item_id ?? "",
    l.process_id ?? "",
    l.basis ?? "",
    l.combo ?? "",
    l.style_ref_no ?? "",
    l.component_id ?? "",
    l.cost_head_id ?? "",
    l.stage_id ?? "",
  ].join("|");
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const same = (a: number | string | null | undefined, b: number | string | null | undefined) => {
  const x = num(a);
  const y = num(b);
  return x === y || (x !== null && y !== null && Math.abs(x - y) < 1e-9);
};
const txt = (v: string | null | undefined) => (v ?? "").trim();

/** Did the APPROVED version price this line? An FOC line is priced at nothing, deliberately. */
export function wasRated(l: BudgetScopeLine): boolean {
  if (l.is_foc) return true;
  const r = num(l.rate);
  return r !== null && r !== 0;
}

const RATE_FIELDS = ["rate", "ex_rate", "no_of_pcs", "no_of_units"] as const;

function rateDiffers(a: BudgetScopeLine, b: BudgetScopeLine): boolean {
  for (const f of RATE_FIELDS) if (!same(a[f], b[f])) return true;
  return (
    txt(a.currency_code) !== txt(b.currency_code) ||
    txt(a.rate_type) !== txt(b.rate_type) ||
    !!a.is_foc !== !!b.is_foc ||
    !!a.is_import !== !!b.is_import
  );
}

/** A hand-typed line's whole content, for the own sections. */
function ownBody(l: BudgetScopeLine): string {
  return JSON.stringify([
    budgetLineKey(l),
    txt(l.description),
    num(l.qty),
    l.uom_id ?? "",
    num(l.rate),
    txt(l.currency_code),
    num(l.ex_rate),
    txt(l.rate_type),
    !!l.is_foc,
    !!l.is_import,
    num(l.no_of_pcs),
    num(l.no_of_units),
    num(l.cutting_rate),
    num(l.making_rate),
    num(l.checking_rate),
    num(l.ironing_rate),
    num(l.packing_rate),
    txt(l.specification),
  ]);
}

/** The approved lines, indexed for the screen and the check. */
export type BudgetBaselineIndex = {
  /** key → the approved line, for purchase / process lines. */
  byKey: Map<string, BudgetScopeLine>;
  /** The own sections' bodies, as a multiset. */
  own: Map<string, number>;
};

export function budgetBaselineIndex(lines: readonly BudgetScopeLine[]): BudgetBaselineIndex {
  const byKey = new Map<string, BudgetScopeLine>();
  const own = new Map<string, number>();
  for (const l of lines) {
    if (isOwnBudgetSource(l.source)) {
      const b = ownBody(l);
      own.set(b, (own.get(b) ?? 0) + 1);
    } else if (!byKey.has(budgetLineKey(l))) byKey.set(budgetLineKey(l), l);
  }
  return { byKey, own };
}

/** Is this line's RATE locked by the amendment? (Screen: the rate cells go read-only.) */
export function rateLockedByAmendment(ix: BudgetBaselineIndex, l: BudgetScopeLine): boolean {
  if (isOwnBudgetSource(l.source)) return true;
  const was = ix.byKey.get(budgetLineKey(l));
  return !!was && wasRated(was);
}

/**
 * Why this budget cannot be saved / submitted as it stands, under an
 * amendment that did not pick Order Budget — null when it can.
 */
export function budgetScopeProblem(v: {
  entryNo: string | null;
  baseline: readonly BudgetScopeLine[];
  baselineHeader: { currency_code?: string | null; exchange_rate?: number | string | null };
  next: readonly BudgetScopeLine[];
  nextHeader: { currency_code?: string | null; exchange_rate?: number | string | null };
}): string | null {
  const head = `Revision ${(v.entryNo ?? "").trim() || "open"} did not pick Order Budget — `;
  const tail = " Use + Add module on the revision to open Order Budget.";

  /* NO HEADER CHECK. The budget's own currency and exchange rate left the
     screen (client 2026-09-19, shot 2957) and a save writes the schema's
     defaults over them, so comparing them would refuse a save over fields
     nobody can see or type. Every rate that matters is on its LINE. */
  void v.baselineHeader;
  void v.nextHeader;

  const ix = budgetBaselineIndex(v.baseline);
  const remaining = new Map(ix.own);
  for (const l of v.next) {
    if (isOwnBudgetSource(l.source)) {
      const b = ownBody(l);
      const n = remaining.get(b) ?? 0;
      if (n === 0) {
        return `${head}${SOURCE_WORD[l.source] ?? l.source} stay as approved; "${txt(l.description) || "a line"}" was added or changed.${tail}`;
      }
      remaining.set(b, n - 1);
      continue;
    }
    const was = ix.byKey.get(budgetLineKey(l));
    if (was && wasRated(was) && rateDiffers(was, l)) {
      return `${head}the approved rate on "${txt(l.description) || txt(was.description) || "a line"}" stays as approved. Only a line the approved version did not price takes a new rate.${tail}`;
    }
  }
  for (const [body, n] of remaining) {
    if (n > 0) {
      const src = (JSON.parse(body) as string[])[0].split("|")[0];
      return `${head}${SOURCE_WORD[src] ?? src} stay as approved; a line was removed.${tail}`;
    }
  }
  return null;
}
