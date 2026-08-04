/**
 * THE GARMENT REJECTION RULE, in one function.
 *
 * A buyer orders 1,000 pieces. Cutting and printing will spoil some, so the
 * factory must make more than 1,000 to still box 1,000 good ones. How many more
 * is a tiered rule, and this is the only place that arithmetic lives — the rule
 * master's preview strip, the SQ Detail screen and `createSqDetail` on the
 * server all call it, so what an operator checks while building a rule, what
 * they see before saving a document, and what is stored cannot disagree
 * (client 2026-08-04).
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

export type RejectionAllowanceType = "flat" | "percent";

export const REJECTION_ALLOWANCE_TYPES: { value: RejectionAllowanceType; label: string }[] = [
  { value: "flat", label: "Pieces" },
  { value: "percent", label: "Percent" },
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
