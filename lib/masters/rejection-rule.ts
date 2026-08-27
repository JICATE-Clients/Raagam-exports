/**
 * THE GARMENT REJECTION RULE, in one function.
 *
 * A buyer orders 1,000 pieces. Cutting and printing will spoil some, so the
 * factory must make more than 1,000 to still box 1,000 good ones. How many more
 * is a tiered rule, and this is the only place that arithmetic lives — the SQ
 * Detail screen, the Approval Qty tab and `createSqDetail` on the server all
 * call it, so what an operator sees before saving a document and what is stored
 * cannot disagree (client 2026-08-04).
 *
 * The rule MASTER no longer calls it. Its preview strip was removed on
 * 2026-08-26 at the client's word, along with the ladder checker beside it, so
 * the master now only enters tiers and everything that computes from them lives
 * downstream.
 *
 * The client's "Basic Rejection Rule":
 *
 *   order 1 – 15      + 3 PIECES     2 ordered    →  5
 *   order 16 – 100    + 8 PERCENT    50 ordered   → 54
 *   order 101 +       + 5 PERCENT    1,000 ordered→ 1,050
 *
 * Note the first tier is a COUNT and the other two are PERCENTAGES, in one rule.
 * That is why `allowance_type` had to be added (0389): before it, a tier stored
 * one bare number with no way to say which of the two it meant, so the rule could
 * be typed in and never computed from.
 *
 * No `server-only` — the master screen is a client component and imports this
 * directly.
 */

/** One tier, as stored on `garment_rejection_rule_lines`. */
export type RejectionTier = {
  /** Inclusive lower bound of the order quantity this tier covers. */
  from_value: number | null;
  /** Inclusive upper bound. NULL is UNBOUNDED — how "101 and above" is entered. */
  to_value: number | null;
  rejection_allowance: number | null;
  /** "flat" = pieces, "percent" = a share of the order quantity. */
  allowance_type: RejectionAllowanceType;
};

/*
 * A `min_pieces` FLOOR was built here on 2026-08-26 and removed the same day,
 * at the client's word: "maintain the same fields legacy have, only 4 —
 * Range, From, To, Rejection Allowance". Migration 0467 was reverted with it.
 *
 * Recorded rather than silently dropped, because the problem it solved is still
 * live and nothing reports it any more. A bracketed percentage cannot say
 * "5%, but never fewer than 3 pieces", so the rate has to step down at a
 * boundary and the cut quantity falls there — see the note below `rejectionFor`
 * for the two places the client's own rule does exactly that. With no floor the
 * only remedy is to raise the tier's RATE, which works but lifts the whole tier
 * and so moves the next boundary too.
 *
 * If it is ever wanted back: one nullable numeric column, and `Math.max` before
 * the `Math.ceil` in `rejectionFor`. Do not re-add it without asking — four
 * fields is a decision, not an oversight.
 */

/**
 * Which of the three range shapes a tier is, DERIVED from its bounds.
 *
 * The legacy screen stores this as a fourth column beside From and To, and we
 * deliberately do not: the bounds already say it, and a stored kind is a second
 * home for one fact plus a way for the two to disagree. No `from` means "up to",
 * no `to` means "above", both means "between" — which is also exactly what
 * `rejectionFor` reads, so the label on screen and the matching cannot drift.
 *
 * A row with NEITHER bound is a blank line the operator has not filled in. It
 * reports as "between" because that is the shape they are part-way through
 * typing, and `rejectionFor` refuses to match it at all.
 */
export type RangeKind = "upto" | "between" | "above";

export const RANGE_KINDS: { value: RangeKind; label: string }[] = [
  { value: "upto", label: "Up to" },
  { value: "between", label: "Between" },
  { value: "above", label: "Above" },
];

export function rangeKindOf(tier: Pick<RejectionTier, "from_value" | "to_value">): RangeKind {
  if (tier.from_value == null && tier.to_value != null) return "upto";
  if (tier.to_value == null && tier.from_value != null) return "above";
  return "between";
}

/**
 * The caption for a tier, composed rather than typed.
 *
 * `range_label` stays a free-text column and is still never parsed — this only
 * fills it in, and an operator may overwrite it. Composing it is what stops the
 * legacy habit of typing "UPTO" into a box beside bounds that say something
 * else; the caption can no longer contradict the numbers unless someone edits
 * it on purpose.
 */
export function rangeLabelOf(tier: Pick<RejectionTier, "from_value" | "to_value">): string {
  const n = (v: number) => v.toLocaleString("en-IN");
  const kind = rangeKindOf(tier);
  if (kind === "upto") return `UP TO ${n(tier.to_value as number)}`;
  if (kind === "above") return `${n(tier.from_value as number)} AND ABOVE`;
  if (tier.from_value == null || tier.to_value == null) return "";
  return `${n(tier.from_value)} TO ${n(tier.to_value)}`;
}

export type RejectionAllowanceType = "flat" | "percent";

/**
 * The two words the Basis column shows, and they are the CLIENT'S words.
 *
 * **Flat and %, never "Pieces" and "Percent"** (client 2026-08-26: "percentage
 * and flat, not a piece"). The legacy column reads exactly this — `Flat` on the
 * first two rows of their rule and `%` on the last three — so an operator moving
 * across recognises the column without being taught a new vocabulary.
 *
 * The first cut of this screen said "Pieces", and the objection is not
 * cosmetic: this column names a METHOD, not a unit. "Flat" says the allowance is
 * taken as-is; "%" says it is taken as a share of the order. That a flat
 * allowance happens to be counted in pieces is a consequence, and putting the
 * unit in the method's name reads as though the column were asking what the
 * number is measured in — which is the one thing it is not asking.
 */
export const REJECTION_ALLOWANCE_TYPES: { value: RejectionAllowanceType; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "percent", label: "%" },
];

export type RejectionResult = {
  /** Extra pieces to produce. Always a whole number — see the rounding note. */
  rejectionQty: number;
  /** Order + rejection. The "SD Qty" the floor is asked to make. */
  sdQty: number;
  /** The tier that answered, so a screen can show WHICH rule applied. */
  tier: RejectionTier;
};

/**
 * How many extra pieces this rule asks for on an order of `orderQty`.
 *
 * Returns **null** when no tier covers the quantity, and that is deliberate: a
 * quantity falling in a gap between tiers is a rule that needs fixing, and
 * returning 0 would render as "no rejection needed" — the one answer a rejection
 * rule never intends. The caller shows the gap instead of a number.
 *
 * ROUNDS UP (client 2026-08-04). 50 + 8% = 54 and 1,000 + 5% = 1,050 divide
 * evenly, so every example in the brief is unaffected and the decision is
 * invisible on them — but 55 + 8% = 59.4, and shipping 59 when 60 were needed is
 * precisely the failure this rule exists to prevent. The cost of the other
 * direction is at most one garment.
 *
 * Tiers are matched on the ORDER QUANTITY. `range_label` beside them in the
 * master is a free-text caption ("1 TO 15") and is never parsed — the numbers
 * decide.
 */
export function rejectionFor(
  orderQty: number,
  tiers: readonly RejectionTier[],
): RejectionResult | null {
  if (!Number.isFinite(orderQty) || orderQty <= 0) return null;

  // First match wins. Rules are entered in ascending order and the bands do not
  // overlap; if someone types overlapping bands, the earlier row is the one they
  // read first on screen, so it is the one that should answer.
  const tier = tiers.find((t) => {
    const from = t.from_value ?? null;
    const to = t.to_value ?? null;
    // A tier with no lower bound covers everything up to `to` — the mirror of the
    // unbounded top tier, and the natural way to write "up to 15".
    if (from != null && orderQty < from) return false;
    if (to != null && orderQty > to) return false;
    // A row with neither bound is a blank line the operator has not filled in;
    // it must not silently swallow every quantity.
    return from != null || to != null;
  });
  if (!tier) return null;

  const allowance = tier.rejection_allowance;
  if (allowance == null || !Number.isFinite(allowance)) return null;

  const raw = tier.allowance_type === "flat" ? allowance : (orderQty * allowance) / 100;
  const rejectionQty = Math.ceil(raw);
  return { rejectionQty, sdQty: orderQty + rejectionQty, tier };
}

/*
 * A LADDER CHECKER lived here from 2026-08-26 until later the same day.
 *
 * `ladderIssues()` reported, on every keystroke, the things no single tier can
 * see: a gap, an overlap, a missing unbounded top tier, and — the one nothing
 * anywhere else reports — a BACKWARD STEP. It is removed because the client
 * removed its strip from the screen, and a check nothing renders is the exact
 * shape of defect this file already carries a scar from: `allowance_type`
 * existed in the column, the type, the engine and the preview for months while
 * no control set it, so every tier saved as "percent" and the client's own flat
 * brackets could not be entered at all. Unreachable code is not a safety net.
 *
 * WHAT IT FOUND IS STILL TRUE, and is written down here because the rule itself
 * has not changed. Take the client's five brackets (up to 10 → 3 Flat; 11–50 →
 * 2 Flat; 51–500 → 5%; 501–1,000 → 3%; 1,001+ → 2%) and the cut quantity goes
 * BACKWARDS twice:
 *
 *     order   500  →  cut   525        order   501  →  cut   517
 *     order 1,000  →  cut 1,030        order 1,001  →  cut 1,022
 *
 * One more garment ordered, eight fewer cut. It is not a typo — it is what
 * bracketed percentages do at every rate step-down, and it is invisible in a
 * table of five rows. Raising 501–1,000 to 4.8% and 1,001+ to 4.7% removes both
 * (a rate lifts the WHOLE tier, so the two have to be fixed bottom-up, one pass
 * each).
 *
 * `scripts/check-rejection-ladder.mts` keeps a vector for the arithmetic that
 * produces those figures, so the claim above stays honest even with nothing
 * reporting it on screen.
 */

/**
 * The quantity the floor is asked to make.
 *
 * `excess_qty` is a SECOND, independent buffer that `sq_details` already carries
 * (`excess_pct` / `excess_qty`) and the rejection brief never mentions. It is 0 on every row
 * today, so including it matches all three worked examples exactly while not
 * silently discarding a number an operator did type. If excess turns out to be
 * meant as something other than "also produce these", this is the line to change.
 */
export function sdQtyOf(orderQty: number, excessQty: number, rejectionQty: number): number {
  return (orderQty || 0) + (excessQty || 0) + (rejectionQty || 0);
}
