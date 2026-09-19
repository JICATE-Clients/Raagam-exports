/**
 * Order Budget — what the grouped orders are worth, what they cost, and the
 * difference.
 *
 * Step 5 of the client's order flow. `doc/prd.md`, in the client's own words:
 *
 *   "After BOM, budgeting is done using Fabric BOM and Material BOM of various
 *    orders which are grouped together. This budget is approved. After approval
 *    it should downstream to purchase module."
 *
 * Three things follow from that sentence and all three shape this module: a
 * budget covers MANY orders, its cost lines come from the two BOMs, and the
 * number that matters is the comparison between those costs and what the orders
 * will sell for.
 *
 * ## A PARTIAL SUM IS THE FAILURE THIS MODULE EXISTS TO PREVENT
 *
 * `order-value.ts` records the rule for one order and it is sharper across a
 * group: if one of five orders cannot be valued, adding the other four gives a
 * smaller sales figure, a healthier-looking cost ratio, and a profit percentage
 * that is simply wrong. Nothing on screen would say four-fifths of an answer had
 * been shown. So an unresolved order poisons the WHOLE profit figure, and the
 * budget names which order it was.
 *
 * Costs are different and deliberately so: a cost line either has a number or is
 * not a line yet. There is no "unresolvable" cost, so the cost total is always
 * answerable and is shown even while the sales side refuses — which is what lets
 * an operator build a budget before every price is confirmed.
 *
 * ## INCOME ADDS. IT IS NOT A NEGATIVE COST.
 *
 * The legacy budget has Other Expenses and Other Incomes as separate tabs, and
 * they are separate here for a reason beyond tidiness: folding income into cost
 * as a negative makes the COST TOTAL wrong — which is the figure a purchase
 * ceiling is checked against, and the one number in this document that is not
 * merely informational.
 *
 * Client-safe (no `server-only`) for the reason every other engine here is: the
 * figures recalculate as the operator types, and the server stores what these
 * same functions produce.
 */

import { money } from "@/lib/finance/calc";
import { inrValue } from "@/lib/orders/amendments/order-value";
import { styleKey } from "@/lib/orders/amendments/style-key";

/**
 * ONE ORDER'S CONTRIBUTION TO A BUDGET, IN INR, OR THE REASON THERE ISN'T ONE.
 *
 * Pure, and it lives here rather than in `service.ts` for exactly one reason:
 * `service.ts` is `server-only`, so nothing in it can be reached by a vector.
 * The arithmetic here is one call to `inrValue`; the part that needed testing is
 * the ORDER OF THE REFUSALS below, which is a judgement rather than a formula.
 *
 * ## WHY THE VALUE IS CONVERTED AT ALL
 *
 * `orderValue` answers in the buyer's own currency. Handing that straight to a
 * budget lets a USD order and an INR order be ADDED TOGETHER UNCONVERTED - an
 * ordinary-looking total that is the sum of two different units, feeding the
 * profit margin. That was live until 2026-08-21.
 *
 * ## THE RATE IS THE SECOND QUESTION, NEVER THE FIRST
 *
 * An order with no price at all also has no exchange rate worth mentioning, and
 * saying "no exchange rate" about it sends the operator to the Logistic tab when
 * the hole is on the Prices tab. So a missing gross value is reported first and
 * the rate is only named once there is a real figure it could have converted.
 *
 * A 0 rate is "not entered", not "worthless": `ex_rate` is `NOT NULL DEFAULT 0`,
 * so the column an operator has not filled in reads as zero, and zero times a
 * real gross value is 0.00. `inrValue` refuses it, and this carries the refusal
 * out as a sentence rather than a number.
 */
export function orderSalesValue(v: {
  grossValue: number | null;
  unresolved: readonly string[];
  exRate: number | null | undefined;
  currencyCode: string | null | undefined;
}): { value: number | null; refusal: string | null } {
  const inr = inrValue(v.grossValue, v.exRate, v.currencyCode);
  if (inr != null) return { value: inr, refusal: null };

  if (v.grossValue == null) {
    return {
      value: null,
      // NAMES THE STYLES, not just "unresolved" — the operator has to go and fix
      // one row on one tab, and a bare refusal sends them hunting.
      refusal:
        v.unresolved.length > 0
          ? `no single price for ${v.unresolved.join(", ")}`
          : "no quantity on the Styles tab",
    };
  }
  return { value: null, refusal: "no exchange rate on the order's Logistic tab" };
}

// `money` is imported rather than redefined. There are already three copies of
// two-decimal rounding in this repo (finance, hr, and a private one inside
// order-value.ts), and they do not all agree — the finance one adds
// `Number.EPSILON` before rounding and the others do not. A fourth copy would be
// a fourth answer to "what is 0.145 to two places" on a screen whose whole job
// is money.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where a budget line's figure comes from.
 *
 * `fabric`, `yarn`, `material`, the four `*_process` sources and `cmt` (0574)
 * are PULLED from the BOMs and the order; only `expense` and `income` are
 * typed. The distinction is not cosmetic — a pulled line's quantity is a stored requirement somebody else computed, so re-typing it
 * here would be a second answer to a question already answered.
 *
 * `yarn` IS ITS OWN SOURCE AND NOT A KIND OF `material` (0493). It comes from a
 * third place — the Fabric BOM's Yarn Process tab, not the Material BOM — and
 * the client asks for it by name as "the Yarn Purchase section of the Budget".
 * Folding it into `material` would leave the budget unable to say which document
 * a line came from or which section to show it under, and a re-pull would then
 * have to guess which existing lines it was replacing.
 */
/*
 * `process` (typed) WAS RETIRED BY 0573. It was one free-text bucket for every
 * fabric and garment step, so a budget could not say which fabric a dyeing
 * charge was for or re-pull it when the BOM changed. It became three PULLED
 * sources — one per document a process hangs off — and 0573 rewrites any
 * `process` row as `garment_process`, the only one of the three an operator
 * could have meant by typing it (the other two are fabric and trim steps the
 * BOMs already name).
 *
 * Each `*_process` sits directly after the thing it processes. The order no
 * longer decides the screen's sections (`BUDGET_SECTIONS` does), but it is the
 * order a flat list or an export walks, and a dyeing charge read next to the
 * fabric it dyes needs no explaining.
 */
export const BUDGET_SOURCES = [
  "fabric",
  "yarn",
  "yarn_process",
  "fabric_process",
  "material",
  "material_process",
  "garment_process",
  "cmt",
  "expense",
  "income",
] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

export const BUDGET_SOURCE_LABELS: Record<BudgetSource, string> = {
  fabric: "Fabric",
  /* "Yarn Purchase", the client's own words for the section, rather than the
     bare "Yarn" the other labels' pattern would suggest — this line is a
     PURCHASE of raw material, and a budget reader scanning a column of
     one-word labels would otherwise read it as a second fabric row. */
  yarn: "Yarn Purchase",
  /* "Yarn Processing", the second of the two sections the client names for this
     tab. A separate source from `fabric_process` because it is a step on the
     YARN, costed by weight of yarn before it is knitted — and it is PULLED — its quantity is a weight the
     Fabric BOM computed, and re-typing it would be a second answer to an
     answered question. */
  yarn_process: "Yarn Processing",
  fabric_process: "Fabric Processing",
  material: "Material",
  /* "Accessory", not "Material" — the tab is Accessories Processes, and the
     Material BOM is trims and packing. */
  material_process: "Accessory Processing",
  garment_process: "Garment Processing",
  cmt: "CMT",
  expense: "Other expense",
  income: "Other income",
};

/** The sources that are PULLED from a BOM rather than typed. */
export const PULLED_SOURCES: ReadonlySet<BudgetSource> = new Set<BudgetSource>([
  "fabric",
  "yarn",
  "yarn_process",
  "fabric_process",
  "material",
  "material_process",
  "garment_process",
  /* PULLED SINCE 0574: one line per (order, style, coordinate), its qty the
     style's SQ Qty. "+ Add" still allows a manual CMT line — pulled describes
     where the quantity usually comes from, not a ban on typing one. */
  "cmt",
]);

/**
 * The budget editor's rail sections, and which sources each one shows.
 *
 * ## EVERY SOURCE IS IN EXACTLY ONE SECTION
 *
 * Not a style rule. A source in NO section is a line the screen cannot show —
 * it is still added into the cost total, so the operator sees a figure made of
 * lines they cannot find. A source in TWO is a line shown twice, which reads as
 * two lines and invites deleting "the duplicate". `check-budget-totals.mts`
 * asserts the partition, so a ninth source fails there rather than vanishing.
 *
 * Process Rates holds all four `*_process` sources even though each comes from a
 * different document: the client groups by what the money is spent ON
 * (processing), not by where the line came from — that is `PULLED_SOURCES`' and
 * the source's own job, not this.
 */
export type BudgetSectionKey = "purchase" | "process" | "cmt" | "expense" | "income";
export type BudgetSection = {
  key: BudgetSectionKey;
  label: string;
  sources: readonly BudgetSource[];
};

export const BUDGET_SECTIONS: readonly BudgetSection[] = [
  { key: "purchase", label: "Purchase Rates", sources: ["yarn", "fabric", "material"] },
  {
    key: "process",
    label: "Process Rates",
    sources: ["yarn_process", "fabric_process", "material_process", "garment_process"],
  },
  { key: "cmt", label: "CMTs", sources: ["cmt"] },
  { key: "expense", label: "Other Expenses", sources: ["expense"] },
  { key: "income", label: "Other Incomes", sources: ["income"] },
];

/**
 * Purchase Rates' child tabs — one grid per source, in the blueprint's order.
 * "Accessories Purchases" is the client's name for `material`: the Material BOM
 * is trims and packing, and "Material" alone would read as the fabric too.
 */
export type PurchaseTab = { source: "yarn" | "fabric" | "material"; label: string };

export const PURCHASE_TABS: readonly PurchaseTab[] = [
  { source: "yarn", label: "Yarn Purchases" },
  { source: "fabric", label: "Fabric Purchases" },
  { source: "material", label: "Accessories Purchases" },
];

/** Process Rates' child tabs, in the blueprint's order — the same order as
 *  that section's `sources`, which the vectors assert. */
export type ProcessTab = {
  source: "yarn_process" | "fabric_process" | "material_process" | "garment_process";
  label: string;
};

export const PROCESS_TABS: readonly ProcessTab[] = [
  { source: "yarn_process", label: "Yarn Processes" },
  { source: "fabric_process", label: "Fabric Processes" },
  { source: "material_process", label: "Accessories Processes" },
  { source: "garment_process", label: "Garment Processes" },
];

/**
 * A budget line's editable fields that a refusal can be ABOUT.
 *
 * `base` is not a box on the line: it is the sales value a percent line takes
 * its share of, which the operator fixes on the ORDER — the screen shows that
 * one in the Amount cell, since there is no field of the line's own to put it
 * under. `currency` is in the vocabulary for the screen's own checks; nothing
 * in this engine refuses over it, since a blank currency is INR.
 */
export type LineField = "qty" | "no_of_pcs" | "no_of_units" | "rate" | "ex_rate" | "currency" | "base";

/**
 * What the screen prints when a figure cannot be produced. Never an empty
 * string: a blank cell and a refused cell must not look alike.
 *
 * ## A REFUSAL NAMES ITS FIELD (2026-09-18)
 *
 * A bare sentence can only be printed where the FIGURE goes — so "Enter a
 * rate" sat in the Amount column, three cells from the Rate box it was about,
 * and a blocked Save could only say so in a toast (user: "it should only show
 * below the exact field"). `field` says which box, so the screen can put the
 * sentence under it and land the cursor there. Optional: a refusal about a
 * TOTAL (sales, cost, a margin) is about no single field, and says so by
 * leaving it out.
 */
export type Refusal = { refused: string; field?: LineField | CmtOperationKey };

/** A refusal about one line — always names its field. What `lineAmount`,
 *  `lineInrRate` and `lineReqd` return, so a caller never has to guess. */
export type LineRefusal = { refused: string; field: LineField };

/* The guard names the BARE shape `{ refused: string }`, not `Refusal`, on
   purpose. Since `field` joined `Refusal`, a caller whose own union spells the
   bare shape (`number | { refused: string }`) was no longer narrowed by
   `v is Refusal` — the bare shape is not a strict subtype of one with an
   extra optional key — and seven lines of the budget screen stopped
   compiling. Narrowing to the bare shape works for both spellings, and a
   `number | Refusal` / `number | LineRefusal` input still narrows to that
   type, `field` included. */
export function isRefusal(v: unknown): v is { refused: string } {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

/**
 * THE ONE REFUSAL THAT IS NOT A PROBLEM. A budget with no orders yet refuses
 * every sales-based figure for the same reason — there is nothing to sell — and
 * that is the normal state of a NEW budget, not a fault to fix. Named once so
 * the screens can tell it apart from a real refusal (a missing price, mixed
 * currencies) and show a muted dash instead of fifteen red copies of it
 * (Budget ▸ General, 2026-09-19). The engine still refuses: a dash is not a 0.
 */
export const NO_ORDERS_YET = "No orders in this budget yet";

export function isNoOrdersYet(v: unknown): boolean {
  return isRefusal(v) && v.refused === NO_ORDERS_YET;
}

export function budgetSourceOf(v: string | null | undefined): BudgetSource | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (BUDGET_SOURCES as readonly string[]).includes(k)
    ? (k as BudgetSource)
    : { refused: "Choose what this line is for" };
}

// ---------------------------------------------------------------------------
// A line
// ---------------------------------------------------------------------------

export type BudgetLineInput = {
  source: string | null;
  qty: number | null;
  /** In the LINE's currency (0572). Every row saved before 0572 has no
   *  currency, and its rate was INR — so a blank currency keeps meaning INR. */
  rate: number | null;
  /* The three below are OPTIONAL so every caller written before 0572 compiles
     and values its lines exactly as it did: no currency is INR, no FOC flag is
     a paid line. */
  /** NULL / blank = INR. */
  currency_code?: string | null;
  /** INR per one unit of `currency_code`. NULL when the line is in INR. */
  ex_rate?: number | null;
  /** Free of cost — supplied by the buyer or thrown in by the vendor. */
  is_foc?: boolean;
  /* The three below are 0573's, OPTIONAL for the same reason: absent, a line
     is per-unit with one piece of one unit, which is exactly how every line
     before 0573 was valued. */
  /** `flat` = `rate` IS the charge; `per_unit` (default) = `rate` per unit of
   *  Reqd; `percent` = `rate` % of the sales of the line's scope (Other
   *  Expenses / Incomes — commission, discount, insurance). "Per KG" / "Per
   *  Piece" is not stored — it is `per_unit` read off the UOM, and storing both
   *  would be two facts about one. */
  rate_type?: "per_unit" | "flat" | "percent";
  /** Garment Processes: pieces per garment the step is done to. NULL = 1. */
  no_of_pcs?: number | null;
  /** Garment Processes: units per piece. NULL = 1. */
  no_of_units?: number | null;
  /** The order this line belongs to — a percent line's SCOPE (see `SalesScope`). */
  garment_order_id?: string | null;
  /** The style this line belongs to — narrows a percent line's scope further. */
  style_ref_no?: string | null;
  /** For naming the line when its total has to refuse over it. */
  description?: string | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A line's requirement — `qty x no_of_pcs x no_of_units`, or why there isn't one.
 *
 * ## REQD IS DERIVED, LIKE AMOUNT
 *
 * A garment step is priced per operation, and a garment carries several: two
 * pockets printed, one logo each, is 2 x 1 per garment. `qty` holds the pulled
 * production target and the two multipliers hold the counts, so a stored Reqd
 * beside them would be the "three numbers stating two facts" failure that
 * `lineAmount` already refuses. Blank pcs / units are 1 — which is what makes
 * every other source (none of which has either) come out unchanged.
 *
 * ## 0 IS NOT 1
 *
 * A blank multiplier means "one"; a typed 0 means somebody entered a count of
 * nothing, and multiplying by it would cost a real garment step at 0.00 — the
 * "0 is not an answer" failure with the zero one column along. So a typed value
 * must be above 0, and the refusal names which box.
 *
 * Not rounded: it is a quantity (kilograms, on most sources), and `lineAmount`
 * rounds the money once at the end.
 */
export function lineReqd(line: BudgetLineInput): number | LineRefusal {
  const qty = num(line.qty);
  if (qty == null || qty <= 0) {
    return { refused: "Enter a quantity — use 1 for a lump sum", field: "qty" };
  }

  const pcs = num(line.no_of_pcs);
  if (pcs != null && pcs <= 0) {
    return { refused: "No of Pcs must be more than 0 — leave it blank for 1", field: "no_of_pcs" };
  }
  const units = num(line.no_of_units);
  if (units != null && units <= 0) {
    return { refused: "No of Units must be more than 0 — leave it blank for 1", field: "no_of_units" };
  }

  return qty * (pcs ?? 1) * (units ?? 1);
}

/** The currency a budget line's `rate` is stated in. */
const BUDGET_HOME_CURRENCY = "INR";

/**
 * One line's rate in INR — `rate x ex_rate`, or the reason there isn't one.
 *
 * ## A BLANK CURRENCY IS INR HERE, AND THAT IS NOT `inrValue`'s RULE
 *
 * `inrValue` (order-value.ts) refuses to assume a blank currency is home, and it
 * is right to: an ORDER's currency is a commercial term the buyer agreed, and
 * guessing it values the order wrongly. A budget line's currency is younger than
 * the line — 0572 added the column to rows whose `rate` had always been rupees.
 * Reading NULL as "unknown" would turn every budget saved before today into a
 * wall of refusals over a question nobody was ever asked. So NULL is INR, by the
 * migration's own definition, and an explicit INR converts at 1 whatever rate is
 * sitting beside it — INR to INR is 1 by arithmetic, not by convenience.
 *
 * ## THE EXCHANGE RATE IS THE SECOND QUESTION
 *
 * Same ordering as `orderSalesValue`: a line with no rate has no exchange rate
 * worth asking for, and "Enter the exchange rate for USD" on a line nobody has
 * priced sends the operator to the wrong box. And like there, 0 is "not
 * entered", never "worthless" — a zero rate times a real dollar price is a
 * line quietly costed at nothing.
 *
 * ## NOT ROUNDED — ON PURPOSE
 *
 * This is a PER-UNIT rate, and it is multiplied by a quantity that is routinely
 * in the tens of thousands (grams of yarn, pieces of trim). Rounding USD 0.0137
 * x 84.25 = 1.154225 to 1.15 before that multiplication moves a 50,000-piece
 * line by 211 rupees — a difference no operator could reproduce from the
 * numbers on screen. So the product is returned at full precision, `lineAmount`
 * rounds once at the end, and display is the screen's business.
 *
 * ## A FOC LINE'S INR RATE IS 0
 *
 * Not "Enter a rate": a free-of-cost line is priced, at nothing, and the row
 * must read Qty x INR Rate = Amount like every other row. Showing a typed
 * notional rate beside an amount of 0 would be a row contradicting itself.
 */
export function lineInrRate(line: BudgetLineInput): number | LineRefusal {
  if (line.is_foc === true) return 0;

  const rate = num(line.rate);
  if (rate == null) return { refused: "Enter a rate", field: "rate" };
  if (rate < 0) {
    return { refused: "A rate cannot be negative — use Other income instead", field: "rate" };
  }

  const code = (line.currency_code ?? "").trim().toUpperCase();
  if (code === "" || code === BUDGET_HOME_CURRENCY) return rate;

  const ex = num(line.ex_rate);
  if (ex == null || ex <= 0) return { refused: `Enter the exchange rate for ${code}`, field: "ex_rate" };
  return rate * ex;
}

/**
 * One line's amount — `qty x INR rate`, to two places.
 *
 * ## AMOUNT IS DERIVED AND HAS NO COLUMN
 *
 * The alternative is a typed Amount beside a typed Qty and Rate, which is three
 * numbers stating two facts. They disagree the first time someone edits the rate
 * and not the amount, and the document then holds a total nobody can reproduce
 * from its own lines. A lump sum is entered as qty 1 — visibly, in the box, not
 * as a silent default.
 *
 * A NEGATIVE RATE IS REFUSED, on every source including income. "Income" is
 * already the sign; a negative income is a cost wearing the wrong label, and it
 * would subtract from the wrong total.
 *
 * ## FOC IS PRICED AT NOTHING, NOT UNPRICED
 *
 * A free-of-cost line (0572) answers 0 without asking for a rate. It must not
 * land in `unpriced`: that list is what holds Save and says "this budget is not
 * finished", and a trim the buyer supplies free is finished. It still needs a
 * quantity — it is a real line of real material, and the quantity is what the
 * purchase side will issue against.
 *
 * ## A FLAT RATE IS THE CHARGE, AND THE QUANTITY IS NOT ASKED FOR
 *
 * 0573's `rate_type = 'flat'`: a job worker quotes one sum for a lot ("₹4,000
 * to compact the whole order"). Multiplying that by the pulled Reqd would cost
 * it thousands of times over, and refusing it for a blank quantity would ask
 * for a number the charge does not depend on. So a flat line's amount is its
 * INR rate, and `lineReqd` is not consulted — a pulled quantity still shows on
 * the row for reference, it just is not a factor. FOC still wins: a free step
 * is 0 whatever the job worker quoted.
 *
 * ## A PERCENT LINE IS A SHARE OF SALES, AND READS NOTHING ELSE
 *
 * `rate_type = 'percent'`: `money(base x rate / 100)`, where base is the INR
 * gross sales of the line's scope (a style, an order, or the whole budget —
 * `salesBaseOf`). Qty, pcs, units, currency and exchange rate are never read:
 * a 2% commission is 2% of the sale whatever currency the sale was in, and the
 * base is already INR. FOC is still 0. Without a resolver there is no base to
 * take a share of, and the line says so rather than answering 0.
 */
export function lineAmount(line: BudgetLineInput, base?: SalesBase): number | LineRefusal {
  if (line.rate_type === "percent") {
    if (line.is_foc === true) return 0;
    const pct = percentRate(line);
    if (isRefusal(pct)) return pct;
    if (!base) return { refused: "A percentage needs the sales value", field: "base" };
    const of = base(line);
    // The base's own sentence (it names the order), filed under `base`.
    return isRefusal(of) ? { refused: of.refused, field: "base" } : money((of * pct) / 100);
  }

  if (line.rate_type === "flat") {
    if (line.is_foc === true) return 0;
    const charge = lineInrRate(line);
    return isRefusal(charge) ? charge : money(charge);
  }

  // 0 IS NOT AN ANSWER HERE EITHER, but only for qty — a rate of 0 is a real
  // thing to budget (a free-issue trim, a process the customer pays for) and
  // refusing it would make those unenterable.
  const reqd = lineReqd(line);
  if (isRefusal(reqd)) return reqd;
  if (line.is_foc === true) return 0;

  const rate = lineInrRate(line);
  if (isRefusal(rate)) return rate;

  // Rounded ONCE, here, from the unrounded Reqd and INR rate — see `lineInrRate`.
  return money(reqd * rate);
}

/**
 * A percent line's percentage, or the reason it is not one — the half of a
 * percent line the OPERATOR can fix on the line itself.
 *
 * Split out from `lineAmount` because `budgetTotals` has to tell the two
 * halves apart: a bad percentage is the line's fault (unpriced, holds Save),
 * an unknown sales value is not (pending — see `budgetTotals`).
 *
 * Above 100 is refused: a commission or a discount of more than the whole sale
 * is a typo for a flat charge, and taken as typed it would cost the budget more
 * than the orders bring in.
 */
function percentRate(line: BudgetLineInput): number | LineRefusal {
  const rate = num(line.rate);
  if (rate == null) return { refused: "Enter a rate", field: "rate" };
  if (rate < 0) {
    return { refused: "A rate cannot be negative — use Other income instead", field: "rate" };
  }
  if (rate > 100) return { refused: "A percentage cannot be more than 100", field: "rate" };
  return rate;
}

/**
 * The first thing wrong with a line, and WHICH FIELD it is in — or null when
 * the line produces an amount.
 *
 * Exactly `lineAmount`'s first refusal, same sentence, same order: this is
 * that function read for its field, not a second set of rules. The screen
 * puts `message` under `field` and lands the cursor there on a blocked Save.
 * `base` means the sales value is missing — nothing on the line to fix, so the
 * screen shows it in the Amount cell.
 */
export function lineProblem(
  line: BudgetLineInput,
  base?: SalesBase,
): { field: LineField; message: string } | null {
  const a = lineAmount(line, base);
  return isRefusal(a) ? { field: a.field, message: a.refused } : null;
}

// ---------------------------------------------------------------------------
// The sales a percent line is taken of
// ---------------------------------------------------------------------------

/** Where a percent line points: a style of an order, an order, or (neither
 *  set) the whole budget. Any budget line satisfies it. */
export type SalesScope = {
  garment_order_id?: string | null;
  style_ref_no?: string | null;
};

/** The INR gross sales of a scope, or why it isn't known. */
export type SalesBase = (scope: SalesScope) => number | Refusal;

/** One order in the group, with what it will sell for. */
export type BudgetOrderInput = {
  /** For naming the order in a refusal. */
  label: string;
  /** Null when the order cannot be valued — see `refusal`. */
  sales_value: number | null;
  /** Why it cannot, when it cannot. */
  refusal: string | null;
  /** The garment order's id — what an ORDER-scoped percent line points at.
   *  Optional so callers without percent lines compile unchanged. */
  id?: string | null;
  /** Per-style INR sales — what a STYLE-scoped percent line points at. Absent
   *  means "not known", never "none": see `salesBaseOf`.
   *
   *  NO CALLER SUPPLIES THIS TODAY (2026-09-18). `orderValue` has no per-style
   *  breakdown, and a naive split (style qty x style rate) is wrong for a
   *  Pack-wise order, whose rate is per BOX shared across styles. So a
   *  style-scoped percent line always refuses, telling the operator to charge
   *  it on the order. The field stays so the day a real per-style value exists
   *  it has somewhere to go — and not a day earlier. */
  styles?: readonly { style_ref_no: string; sales_value: number | null; refusal: string | null }[];
};

/** The whole group's sales, refusing on the first unvaluable order. */
function groupSales(orders: readonly BudgetOrderInput[]): number | Refusal {
  if (orders.length === 0) return { refused: NO_ORDERS_YET };
  const bad = orders.find((o) => o.sales_value == null);
  if (bad) {
    return {
      refused: bad.refusal ? `${bad.label}: ${bad.refusal}` : `${bad.label} has no order value yet`,
    };
  }
  return money(orders.reduce((a, o) => a + (num(o.sales_value) ?? 0), 0));
}

/**
 * The resolver a percent line is valued through, built from the budget's orders.
 *
 * ## EVERY SCOPE HAS THE PARTIAL-SUM RULE
 *
 * The group scope IS `budgetTotals().sales` — the same function, so 2% of the
 * budget is 2% of the figure printed as Gross Sales, never of a second sum.
 * An order scope is that order's value or its own refusal. A style scope is
 * that style's value — and when the caller did not hand per-style values over,
 * or this style is not among them, it REFUSES rather than falling back to the
 * order: 3% of the whole order charged as though it were 3% of one style is a
 * commission several times too big, and it would look like a real figure.
 *
 * A line pointing at an order that is not in this budget refuses too — it is
 * a line left behind when its order was taken out of the group, and valuing it
 * at 0 would quietly drop a cost the operator believes is there.
 */
export function salesBaseOf(orders: readonly BudgetOrderInput[]): SalesBase {
  const group = groupSales(orders);
  return (scope) => {
    const orderId = scope.garment_order_id ?? null;
    if (orderId == null) return group;

    const order = orders.find((o) => o.id === orderId);
    if (!order) return { refused: "This line's order is no longer in this budget" };

    const style = styleKey(scope.style_ref_no ?? null);
    if (style === "") {
      if (order.sales_value == null) {
        return {
          refused: order.refusal
            ? `${order.label}: ${order.refusal}`
            : `${order.label} has no order value yet`,
        };
      }
      return order.sales_value;
    }

    const s = order.styles?.find((x) => styleKey(x.style_ref_no) === style);
    if (!s) {
      return { refused: "This style's own sales value isn't known — charge it on the order instead" };
    }
    if (s.sales_value == null) {
      return {
        refused: s.refusal
          ? `${order.label} ${s.style_ref_no}: ${s.refusal}`
          : "This style's own sales value isn't known — charge it on the order instead",
      };
    }
    return s.sales_value;
  };
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

export type BudgetTotals = {
  /** Every cost line added up. REFUSES (since percent lines) when a line's
   *  sales base is unknown — see `pending`. An unpriced line never does. */
  cost: number | Refusal;
  /** Cost broken out by source. A source refuses when one of its lines is pending. */
  costBySource: Record<BudgetSource, number | Refusal>;
  /** Other income. Kept apart from cost — see the header. Refuses like cost. */
  income: number | Refusal;
  /** What the grouped orders will sell for. Refuses rather than part-summing. */
  sales: number | Refusal;
  /** sales + income − cost. Refuses whenever any of the three does. */
  profit: number | Refusal;
  /** profit as a percentage of sales. Refuses when profit does, or sales is zero. */
  profitPct: number | Refusal;
  /** Lines that could not produce an amount, with the reason. Never silently
   *  dropped from the total: they are EXCLUDED and counted here, so a budget
   *  cannot look complete while a line is unanswered. */
  unpriced: { index: number; reason: string; field?: LineField }[];
  /** Percent lines whose percentage is fine but whose sales base is not known
   *  yet. Not the line's fault, so NOT unpriced and does not hold Save — but
   *  their category refuses rather than leaving them out. */
  pending: { index: number; reason: string; field: "base" }[];
};

/**
 * Add a budget up.
 *
 * ## AN UNPRICED LINE IS EXCLUDED AND REPORTED, NOT TREATED AS ZERO
 *
 * A half-typed line contributes nothing to the cost — there is no honest number
 * to add — but a cost total that quietly ignored it would be the "0 is not an
 * answer" failure at document level: smaller, plausible, and believed. The
 * screen shows the count and the Save gate reads it.
 *
 * ## A PENDING LINE MAKES ITS CATEGORY REFUSE — AND THAT IS NOT THE SAME THING
 *
 * A percent line with a good percentage and an unknown sales value (an order
 * still missing a price) is not something the operator can fix on the line, so
 * holding Save over it would block the budget on a different screen's
 * homework. It goes on `pending` instead. But it cannot simply be left out:
 * the cost total without a 5% commission is exactly the smaller, plausible,
 * believed figure this module exists to prevent — and unlike an unpriced line,
 * nothing on screen would be counting it. So its source, and cost (or income),
 * REFUSE, naming the line. The costs that DO answer are still in
 * `costBySource`, so the rest of the breakdown keeps working.
 *
 * Why the asymmetry with `unpriced`: an unpriced line is visibly unfinished on
 * its own row and Save is held until it is fixed, so the total never reaches
 * approval wrong. A pending line can be saved — so the total has to refuse
 * for itself.
 *
 * ## `sales` REFUSES ON THE FIRST UNRESOLVED ORDER
 *
 * Not on all of them, and not by summing what it can. See the header: four
 * fifths of a sales figure produces a profit percentage that is wrong in the
 * flattering direction.
 */
export function budgetTotals(
  lines: readonly BudgetLineInput[],
  orders: readonly BudgetOrderInput[],
): BudgetTotals {
  const costBySource: Record<BudgetSource, number | Refusal> = {
    fabric: 0,
    yarn: 0,
    yarn_process: 0,
    fabric_process: 0,
    material: 0,
    material_process: 0,
    garment_process: 0,
    cmt: 0,
    expense: 0,
    income: 0,
  };
  /* Each entry carries the FIELD so a blocked Save can land the cursor on the
     box at fault. A line with no source has none (the source is not a
     `LineField`), so that one entry leaves it out. */
  const unpriced: { index: number; reason: string; field?: LineField }[] = [];
  const pending: { index: number; reason: string; field: "base" }[] = [];
  let cost: number | Refusal = 0;
  let income: number | Refusal = 0;
  const base = salesBaseOf(orders);

  /* Once a total refuses it stays refused, with the FIRST pending line's
     sentence — adding to a refusal would give a number again. */
  const add = (t: number | Refusal, amount: number) => (isRefusal(t) ? t : money(t + amount));
  const poison = (t: number | Refusal, r: Refusal) => (isRefusal(t) ? t : r);

  lines.forEach((l, i) => {
    const source = budgetSourceOf(l.source);
    if (isRefusal(source)) {
      unpriced.push({ index: i, reason: source.refused });
      return;
    }

    if (l.rate_type === "percent" && l.is_foc !== true) {
      const pct = percentRate(l);
      if (!isRefusal(pct)) {
        const of = base(l);
        if (isRefusal(of)) {
          const name = (l.description ?? "").trim() || `Line ${i + 1}`;
          const r: Refusal = {
            refused: `${name}: no sales value to take ${pct}% of — ${of.refused}`,
          };
          pending.push({ index: i, reason: r.refused, field: "base" });
          costBySource[source] = poison(costBySource[source], r);
          if (source === "income") income = poison(income, r);
          else cost = poison(cost, r);
          return;
        }
      }
    }

    const amount = lineAmount(l, base);
    if (isRefusal(amount)) {
      unpriced.push({ index: i, reason: amount.refused, field: amount.field });
      return;
    }
    costBySource[source] = add(costBySource[source], amount);
    if (source === "income") income = add(income, amount);
    else cost = add(cost, amount);
  });

  const sales = groupSales(orders);

  /* WHICH ONE REFUSED IS PART OF THE ANSWER. Sales keeps its own sentence (it
     already names the order); cost and income say which total could not be
     made, since their sentence names only the line. */
  const profit: number | Refusal = isRefusal(sales)
    ? sales
    : isRefusal(cost)
      ? { refused: `Cost can't be totalled — ${cost.refused}` }
      : isRefusal(income)
        ? { refused: `Income can't be totalled — ${income.refused}` }
        : money(sales + income - cost);

  const profitPct: number | Refusal = isRefusal(profit)
    ? profit
    : (sales as number) <= 0
      ? // A PERCENTAGE OF NOTHING IS NOT 0% — it is undefined, and printing 0%
        // beside a real profit figure is the most confidently wrong thing this
        // document could say.
        { refused: "No sales value to measure the margin against" }
      : Math.round((profit / (sales as number)) * 10000) / 100;

  return { cost, costBySource, income, sales, profit, profitPct, unpriced, pending };
}

// ---------------------------------------------------------------------------
// General — the budget's one-page summary
// ---------------------------------------------------------------------------

export type GeneralCategoryKey = "yarn" | "fabric" | "accessories" | "processing" | "cmt" | "other";
export type GeneralCategory = {
  key: GeneralCategoryKey;
  label: string;
  sources: readonly BudgetSource[];
};

/**
 * The General tab's cost rows.
 *
 * EVERY NON-INCOME SOURCE IS IN EXACTLY ONE ROW, asserted by the vectors, and
 * that is what makes the matrix honest: its total IS `cost`, not a second sum
 * that could part company with it. A source left out would be cost the matrix
 * does not show; one in two rows would be counted twice beneath a total that
 * counts it once. Income is not a row — it is not a cost (see the header).
 */
export const GENERAL_CATEGORIES: readonly GeneralCategory[] = [
  { key: "yarn", label: "Yarn", sources: ["yarn"] },
  { key: "fabric", label: "Fabric", sources: ["fabric"] },
  { key: "accessories", label: "Accessories", sources: ["material"] },
  {
    key: "processing",
    label: "Processing",
    sources: ["yarn_process", "fabric_process", "material_process", "garment_process"],
  },
  { key: "cmt", label: "CMT", sources: ["cmt"] },
  { key: "other", label: "Other Expenses", sources: ["expense"] },
];

export type GeneralSummary = {
  rows: {
    key: GeneralCategoryKey;
    label: string;
    amount: number | Refusal;
    pctOfSales: number | Refusal;
  }[];
  total: { amount: number | Refusal; pctOfSales: number | Refusal };
  sales: number | Refusal;
  income: number | Refusal;
  profit: number | Refusal;
  marginPct: number | Refusal;
  /** Cost per piece MADE (SQ Qty), per the client's spec — not per piece sold. */
  costPerPiece: number | Refusal;
};

/** An amount as a percentage of sales, 2dp — or why there is no percentage. */
function pctOf(amount: number | Refusal, sales: number | Refusal): number | Refusal {
  if (isRefusal(sales)) return sales;
  if (isRefusal(amount)) return amount;
  // A PERCENTAGE OF NOTHING IS NOT 0% — same rule as `profitPct`.
  if (sales <= 0) return { refused: "No sales value to measure against" };
  return money((amount / sales) * 100);
}

/**
 * The General tab: cost by category, each as a share of sales, and the
 * bottom line.
 *
 * Reads `budgetTotals` and adds nothing to it — every figure here is one that
 * function already produced, regrouped. A category refuses when any of its
 * sources does (a pending percent line), with that source's sentence; the
 * others still answer.
 *
 * `costPerPiece` is cost ÷ SQ Qty — the pieces MADE (order + excess + rejection
 * + approval), which is what the cost was incurred on. Dividing by the order
 * quantity instead would spread the cost of the extra pieces over the ones
 * sold and overstate it. It refuses on a refused cost, a refused SQ Qty, or a
 * zero one, never dividing by nothing.
 */
export function generalSummary(totals: BudgetTotals, sqQty: number | Refusal): GeneralSummary {
  const rows = GENERAL_CATEGORIES.map((c) => {
    let amount: number | Refusal = 0;
    for (const s of c.sources) {
      const v = totals.costBySource[s];
      if (isRefusal(v)) {
        amount = v;
        break;
      }
      amount = money(amount + v);
    }
    return { key: c.key, label: c.label, amount, pctOfSales: pctOf(amount, totals.sales) };
  });

  const costPerPiece: number | Refusal = isRefusal(totals.cost)
    ? totals.cost
    : isRefusal(sqQty)
      ? sqQty
      : !(sqQty > 0)
        ? { refused: "No SQ Qty to spread the cost over" }
        : money(totals.cost / sqQty);

  return {
    rows,
    total: { amount: totals.cost, pctOfSales: pctOf(totals.cost, totals.sales) },
    sales: totals.sales,
    income: totals.income,
    profit: totals.profit,
    marginPct: totals.profitPct,
    costPerPiece,
  };
}

// ---------------------------------------------------------------------------
// Process Rates — the grain of a pulled process line (0573)
// ---------------------------------------------------------------------------

/**
 * The grain a Fabric Processes group is costed at — the blueprint's "For".
 *
 * `process` is one line for the whole step, `fabric` one per fabric, `color`
 * one per combo. (0573's column also allows `part`, which is Garment
 * Processes' Partwise; it is never a fabric split, so it is not here.)
 */
export type ProcessBasis = "process" | "fabric" | "color";

/** One (fabric, combo) figure of a process, from the Fabric BOM's stage
 *  breakdown. `qty` is kilograms. */
export type FabricProcessRow = {
  item_id: string | null;
  fabric_name: string;
  combo: string | null;
  qty: number;
};

export type FabricProcessLine = {
  basis: ProcessBasis;
  item_id: string | null;
  combo: string | null;
  description: string;
  qty: number;
};

/**
 * Re-split one process's breakdown at the grain the operator chose.
 *
 * ## THE SAME KILOGRAMS AT EVERY GRAIN
 *
 * Switching For moves the lines, never the weight: a process is done to the
 * same fabric whether it is priced once, per fabric or per colour. So every
 * basis sums the SAME rows, and the vectors assert Σqty is identical across all
 * three. A split that dropped a row it could not key (a fabric with no id, a
 * combo left blank) would make the Processwise figure larger than the
 * Colourwise one — two answers to one requirement, the smaller of which gets
 * costed.
 *
 * So nothing is dropped. A fabric with no `item_id` groups by its name (the
 * breakdown names it even when the id is missing), and a row with no combo is a
 * line of its own, "No colour", rather than being folded into a real one.
 *
 * ## NOT ROUNDED
 *
 * Kilograms, summed at full precision. Rounding each line to 2dp would make the
 * lines stop adding up to the Processwise total, and the money is rounded once,
 * by `lineAmount`.
 *
 * Order is first appearance, so a re-split does not reshuffle rows under the
 * operator's cursor. No rows → no lines: an empty breakdown is not one line of
 * zero kilograms.
 */
export function splitFabricProcess(
  rows: readonly FabricProcessRow[],
  basis: ProcessBasis,
): FabricProcessLine[] {
  const lines = new Map<string, FabricProcessLine>();
  const comboOf = (c: string | null) => {
    const t = (c ?? "").trim();
    return t === "" ? null : t;
  };

  for (const r of rows) {
    let key: string;
    let seed: Omit<FabricProcessLine, "qty">;
    if (basis === "process") {
      key = "";
      seed = { basis, item_id: null, combo: null, description: "All fabrics" };
    } else if (basis === "fabric") {
      // `id:` / `name:` prefixes so a fabric NAMED like another's uuid can never
      // collide with it.
      key = r.item_id != null ? `id:${r.item_id}` : `name:${r.fabric_name.trim()}`;
      seed = { basis, item_id: r.item_id, combo: null, description: r.fabric_name.trim() };
    } else {
      const combo = comboOf(r.combo);
      key = combo ?? "";
      seed = { basis, item_id: null, combo, description: combo ?? "No colour" };
    }
    const line = lines.get(key);
    if (line) line.qty += r.qty;
    else lines.set(key, { ...seed, qty: r.qty });
  }
  return [...lines.values()];
}

/**
 * What makes a pulled line "the same line" on a re-pull.
 *
 * ## TWO PROCESSES ON ONE YARN ARE TWO LINES
 *
 * The screen used to de-duplicate pulled lines on (source, order, item). That
 * was right while a yarn had one purchase line; it is wrong the moment a yarn
 * is dyed AND twisted — both `yarn_process` lines share (source, order, item),
 * so the second was taken for a repeat of the first and silently dropped,
 * taking its cost out of the total. `process_id` tells them apart; `combo` and
 * `basis` do the same for a Fabric Processes group split per colour or per
 * fabric, where one (order, fabric, process) is several lines by design.
 *
 * ## A GARMENT STEP HAS NO ITEM, SO IT NEEDS ITS STYLE AND COMPONENT
 *
 * A `garment_process` line carries no `item_id` and no `combo`, so the same
 * printing step on two styles of one order — or on the chest and the sleeve of
 * one style — keyed identically on the six fields above, and the screen kept
 * one and dropped the other with its cost: the same failure, one source over.
 * `style_ref_no` and `component_id` are what tell those apart. They are
 * APPENDED, never inserted, so every key built before them keeps its shape.
 *
 * Nulls read as "" so a line with none of the later fields (a pre-0573
 * material line) keys as its three fields plus empty tails.
 */
export function pulledLineKey(l: {
  source: string;
  garment_order_id: string | null;
  item_id: string | null;
  process_id?: string | null;
  combo?: string | null;
  basis?: string | null;
  style_ref_no?: string | null;
  component_id?: string | null;
}): string {
  return [
    l.source,
    l.garment_order_id,
    l.item_id,
    l.process_id,
    l.combo,
    l.basis,
    l.style_ref_no,
    l.component_id,
  ]
    .map((v) => v ?? "")
    .join("|");
}

export type CarriedRate = {
  rate: number;
  currency_code: string | null;
  ex_rate: number | null;
  rate_type: "per_unit" | "flat";
};

/**
 * The rate a group's lines agree on, to carry across a re-split — or null.
 *
 * ## A RATE SURVIVES ONLY WHEN IT WAS ONE RATE
 *
 * When For changes, the old lines are replaced, not edited. If every one of
 * them was ₹12/kg, the step costs ₹12/kg at any grain and re-typing it would be
 * busywork. If they differed (navy dyes dearer than white), there is no single
 * rate to hand the new lines, and picking one — the first, an average — would
 * be a price the operator never typed. So: the common rate, or nothing.
 *
 * The rate travels WITH its currency and exchange rate, as one fact (the same
 * rule `copy-from.ts` states): $0.15 carried without its currency is ₹0.15.
 * Currency is compared with a blank and "INR" as the same thing, since
 * `lineInrRate` values them the same; an INR line's `ex_rate` is not compared,
 * since it is never used.
 *
 * ## A FLAT CHARGE NEVER CARRIES
 *
 * A flat rate is the charge for the LINE, and a re-split changes how many
 * lines there are. ₹4,000 for "All fabrics" handed to three per-fabric lines
 * is ₹12,000 — the step costed three times over, with nothing on screen to say
 * so. There is no honest way to divide it (by weight? by line?), so it is not
 * carried and the operator re-enters it at the new grain.
 *
 * A PERCENT RATE never carries either, for the same reason: 2% of the budget on
 * each of three lines is 6%.
 *
 * Null too for no lines, and for a group whose shared rate is blank — there is
 * nothing to carry.
 */
export function carryRate(
  lines: readonly Pick<BudgetLineInput, "rate" | "currency_code" | "ex_rate" | "rate_type">[],
): CarriedRate | null {
  if (lines.length === 0) return null;

  const ccy = (c: string | null | undefined) => {
    const t = (c ?? "").trim().toUpperCase();
    return t === BUDGET_HOME_CURRENCY ? "" : t;
  };
  const first = lines[0];
  const rate = num(first.rate);
  if (rate == null) return null;
  const rateType = first.rate_type ?? "per_unit";
  // Flat AND percent: each is a charge for the LINE, so either multiplies with
  // the number of lines a re-split makes. See "A FLAT CHARGE NEVER CARRIES".
  if (rateType !== "per_unit") return null;

  const home = ccy(first.currency_code) === "";
  const agrees = lines.every(
    (l) =>
      num(l.rate) === rate &&
      (l.rate_type ?? "per_unit") === rateType &&
      ccy(l.currency_code) === ccy(first.currency_code) &&
      (home || num(l.ex_rate) === num(first.ex_rate)),
  );
  if (!agrees) return null;

  return {
    rate,
    // An INR group carries as NULL / NULL — 0572's own spelling of INR, and the
    // only one its (currency_code is null) = (ex_rate is null) check accepts
    // without an exchange rate.
    currency_code: home ? null : ccy(first.currency_code),
    ex_rate: home ? null : num(first.ex_rate),
    rate_type: rateType,
  };
}

// ---------------------------------------------------------------------------
// CMTs — the optional per-operation breakup of a CMT rate (0574)
// ---------------------------------------------------------------------------

export type CmtOperationKey =
  | "cutting_rate"
  | "making_rate"
  | "checking_rate"
  | "ironing_rate"
  | "packing_rate";

/** A CMT line's breakup, per piece, in INR. Every operation optional. */
export type CmtBreakup = Partial<Record<CmtOperationKey, number | null>>;

/**
 * The five operations, in the order a garment goes through them. "Sewing /
 * Making" is ONE operation with the client's two names for it, not two.
 */
export const CMT_OPERATIONS: readonly { key: CmtOperationKey; label: string }[] = [
  { key: "cutting_rate", label: "Cutting" },
  { key: "making_rate", label: "Sewing / Making" },
  { key: "checking_rate", label: "Checking" },
  { key: "ironing_rate", label: "Ironing" },
  { key: "packing_rate", label: "Packing" },
];

/**
 * Round to 4dp the way Postgres rounds a `numeric(14,4)`: half away from zero
 * on the DECIMAL the operator typed. `Math.round(n * 1e4)` is not that —
 * 12.34565 x 1e4 is 123456.49999999999 in binary, which rounds DOWN to 12.3456
 * where Postgres stores 12.3457 (and `money`'s `+ Number.EPSILON` is far too
 * small to rescue it at this magnitude). Shifting the exponent in the string
 * form keeps the arithmetic on the decimal digits. Every caller passes a value
 * ≥ 0.
 *
 * EXPORTED so the Zod schema rounds each breakup column with THIS function. If
 * the columns were left to Postgres's rounding while the rate came from here,
 * the two would be the same rule written twice — and 0574's `rate = Σ breakup`
 * check is exactly where a disagreement in the fourth place would surface.
 */
export function round4(n: number): number {
  const s = String(n);
  // `1e-7` has no decimal digits to shift; the binary route is exact enough
  // for a value that small, and it is the only way to reach one.
  if (s.includes("e")) return Math.round(n * 1e4) / 1e4;
  return Number(`${Math.round(Number(`${s}e4`))}e-4`);
}

/**
 * The CMT rate its breakup adds up to — or null when there is no breakup.
 *
 * ## THE RATE AND THE BREAKUP CANNOT DISAGREE
 *
 * `rate` stays THE rate for every reader (`lineAmount`, the totals, the
 * purchase ceiling); the breakup only explains it. 0574's check holds the two
 * together — whenever any operation is set, `rate` must EQUAL their sum — so
 * the rate is not typed beside a breakup, it is DERIVED from it, here.
 *
 * ## WHY THE ROUNDING IS EXACTLY THIS
 *
 * The five columns and `rate` are all `numeric(14,4)`. Postgres rounds each
 * operation to 4dp on write, then adds them exactly (numeric is decimal, not
 * binary). So this rounds each value to 4dp FIRST — to what will be stored —
 * sums, and rounds the sum to 4dp again. The second rounding changes no
 * decimal answer; it removes binary noise (0.1 + 0.2 is 0.30000000000000004),
 * so the rate the screen shows is the rate the row will hold. Skip the FIRST
 * rounding and round only the sum, and 1.23456 x 5
 * gives 6.1728 against a stored breakup of 5 x 1.2346 = 6.1730: a save the
 * database rejects over a digit nobody typed.
 *
 * ## BLANK IS "NO BREAKUP"; 0 IS AN OPERATION DONE FREE
 *
 * All five blank → null, and the typed rate stands: the breakup is optional,
 * and a single rate typed straight in is the fast path. But a 0 is a real
 * answer — the buyer irons, packing is in the making charge — so a breakup of
 * zeros is a breakup, and its total is 0, not null.
 *
 * A negative operation is refused and named, for `lineAmount`'s reason: a
 * negative charge is a credit wearing the wrong label. Not-a-number counts as
 * blank, the way `num` reads every other figure here.
 */
export function cmtBreakupTotal(b: CmtBreakup): number | Refusal | null {
  let any = false;
  let sum = 0;
  for (const op of CMT_OPERATIONS) {
    const v = num(b[op.key]);
    if (v == null) continue;
    if (v < 0) return { refused: `${op.label} rate cannot be negative`, field: op.key };
    any = true;
    sum += round4(v);
  }
  return any ? round4(sum) : null;
}

// ---------------------------------------------------------------------------
// The Sales half of the bottom bar
// ---------------------------------------------------------------------------

/** One order in the group, as the bottom bar needs it — in the BUYER's terms. */
export type SalesOrderFacts = {
  /** For naming the order in a refusal. */
  label: string;
  qty: number | null;
  unit: string | null;
  currency_code: string | null;
  ex_rate: number | null;
  /** In `currency_code`, before conversion. */
  gross_value: number | null;
};

export type SalesSummary = {
  currency: string | Refusal;
  /** INR per one unit of `currency`. */
  conv: number | Refusal;
  qty: number | Refusal;
  unit: string | Refusal;
  /** Gross value per unit, in `currency`. */
  avgPrice: number | Refusal;
};

/** Every order agrees on one value, or the reason they don't. */
function common<T>(
  values: readonly T[],
  same: (a: T, b: T) => boolean,
  disagree: string,
): T | Refusal {
  const first = values[0];
  return values.every((v) => same(v, first)) ? first : { refused: disagree };
}

/**
 * Currency / Conv / Avg Price / Qty for the whole group of orders.
 *
 * ## THERE IS NO SECOND SALES FIGURE HERE
 *
 * Gross Sales Value is `budgetTotals().sales` — the INR sum, refusing on the
 * first unvaluable order. This function answers only the facts printed BESIDE
 * it, in the buyer's own terms. A second sales total computed here would be a
 * second answer to one question, and the two would part company the first time
 * one of them learned a rule the other did not.
 *
 * ## A GROUP HAS ONE ANSWER, OR IT SAYS WHY IT HASN'T
 *
 * A budget covers several orders, and they need not agree. Each figure is the
 * common value when every order shares it; otherwise it refuses with the reason
 * — never the first order's value standing in for the group, which would print
 * "USD" over a group that is half euros.
 *
 * ## AN AVERAGE ACROSS TWO CURRENCIES OR TWO UNITS IS NOT A PRICE
 *
 * $3.10 a piece and €4.00 a pack average to 3.55 of nothing. So Avg Price
 * refuses whenever Currency or Unit does, carrying THEIR sentence so the
 * operator learns the actual reason. And like the order-level sales rule, one
 * order without a gross value refuses the whole average rather than averaging
 * the rest: a partial average is plausible and wrong.
 *
 * ## A BLANK ORDER CURRENCY IS NOT INR
 *
 * `inrValue`'s rule, not the budget line's: an order's currency is a term the
 * buyer agreed. Conv for an INR group is 1 by arithmetic.
 */
export function salesSummary(orders: readonly SalesOrderFacts[]): SalesSummary {
  if (orders.length === 0) {
    const none: Refusal = { refused: NO_ORDERS_YET };
    return { currency: none, conv: none, qty: none, unit: none, avgPrice: none };
  }

  // --- Currency: the first question. Everything priced depends on it.
  const codes = orders.map((o) => (o.currency_code ?? "").trim().toUpperCase());
  const blankCcy = orders.find((_, i) => codes[i] === "");
  const currency: string | Refusal = blankCcy
    ? { refused: `${blankCcy.label} has no currency` }
    : common(codes, (a, b) => a === b, "Mixed currencies across orders");

  // --- Conv: a rate is a rate OF a currency, so it is the second question.
  let conv: number | Refusal;
  if (isRefusal(currency)) {
    conv = currency;
  } else if (currency === BUDGET_HOME_CURRENCY) {
    conv = 1;
  } else {
    // `> 0`, not `!= null`: the order's `ex_rate` defaults to 0, meaning "not entered".
    const noRate = orders.find((o) => !((num(o.ex_rate) ?? 0) > 0));
    conv = noRate
      ? { refused: `${noRate.label} has no exchange rate` }
      : common(
          orders.map((o) => o.ex_rate as number),
          (a, b) => a === b,
          "Orders use different exchange rates",
        );
  }

  // --- Unit, compared case-insensitively ("Pcs" and "PCS" are one unit).
  const blankUnit = orders.find((o) => (o.unit ?? "").trim() === "");
  const unit: string | Refusal = blankUnit
    ? { refused: `${blankUnit.label} has no unit` }
    : common(
        orders.map((o) => (o.unit as string).trim()),
        (a, b) => a.toUpperCase() === b.toUpperCase(),
        "Orders use different units",
      );

  // --- Qty: added only when every order has one AND they count the same thing.
  // 0 is "not entered" — an order of nothing is not an order, and a zero here
  // would reach the average as a divisor.
  const noQty = orders.find((o) => !((num(o.qty) ?? 0) > 0));
  const qty: number | Refusal = noQty
    ? { refused: `${noQty.label} has no quantity` }
    : isRefusal(unit)
      ? unit
      : orders.reduce((a, o) => a + (o.qty as number), 0);

  // --- Avg Price: weighted (Σ value / Σ qty), never a flat mean of order prices.
  let avgPrice: number | Refusal;
  if (isRefusal(currency)) avgPrice = currency;
  else if (isRefusal(unit)) avgPrice = unit;
  else if (isRefusal(qty)) avgPrice = qty;
  else {
    const noValue = orders.find((o) => num(o.gross_value) == null);
    avgPrice = noValue
      ? { refused: `${noValue.label} has no gross value` }
      : qty <= 0
        ? { refused: "No quantity to average the price over" }
        : // 6dp: the precision of the order's own `avg_rate` (numeric(14,6)), so
          // a one-order budget prints the same average the order does.
          Math.round((orders.reduce((a, o) => a + (o.gross_value as number), 0) / qty) * 1e6) /
          1e6;
  }

  return { currency, conv, qty, unit, avgPrice };
}
