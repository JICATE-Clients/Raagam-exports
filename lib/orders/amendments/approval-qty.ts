/**
 * Approval Qty — the production TARGET, per style line and colour.
 *
 *     Qty + Excess Qty + Approval Qty + Projection = Total Production Qty
 *
 * Client spec 2026-08-10, extended 2026-08-12 with the colour breakdown and the
 * Projection term. Only two of those five are typed; the rest are derived here,
 * in one place, so the screen, the column totals and any later consumer cannot
 * arrive at different numbers for the same order.
 *
 * Client-safe (no `server-only`) for the same reason `style-processes.ts` is:
 * the figures recalculate as the operator types, so they have to run in the
 * browser. The tiers they read come from the server with the form data.
 *
 * ## Everything rounds UP, and that is one decision made once
 *
 * `rejectionFor` already records why: *"shipping 59 when 60 were needed is
 * precisely the failure this rule exists to prevent. The cost of the other
 * direction is at most one garment."* Excess follows it. Two allowances on one
 * order rounding opposite ways would be indefensible on any single line — the
 * operator would see one buffer shaved and the other padded with no rule
 * explaining either.
 *
 * ## Projection returns NULL, never 0, when it cannot answer
 *
 * This is the half that is easy to get wrong and expensive when you do. There
 * are three ways to have no projection and only one of them means "none needed":
 *
 * - no rule chosen on the order — nothing to apply;
 * - a rule whose tiers leave this quantity in a GAP (`rejectionFor` returns
 *   null, deliberately, and its own header explains why);
 * - a genuine zero allowance.
 *
 * Only the third is a number. The first two are "unanswered", and rendering
 * them as 0 tells the floor that no defect buffer is needed — the one answer a
 * rejection rule never intends. The caller shows a dash and, where it can, says
 * which case it is.
 */

import { rejectionFor, type RejectionTier } from "@/lib/masters/rejection-rule";

/** Pieces of this combo the buyer ordered. Typed — see 0413. */
export type ApprovalLine = {
  /** Ordered quantity for this style + combo. */
  qty: number;
  /** Manually entered samples: testing, buyer samples, office records. */
  approvalQty: number;
};

/**
 * `uniformApproval` LIVES IN `approval-tree.ts`, not here, and the reason is
 * that it has to stay VECTORED.
 *
 * It belongs with this file's subject — how a colour's stored approval values
 * collapse to the one answer the screen asks for — but this module imports the
 * rejection engine through the `@/` alias, and `scripts/check-approval-tree.mts`
 * runs under `node --experimental-strip-types` with no bundler to resolve one.
 * Importing it from here would make the whole vector file unrunnable.
 *
 * `approval-tree.ts` imports nothing at all, which is exactly what makes it the
 * home for a rule that must be provable — and it already owns the (style,
 * combo, size) shape this reduces over.
 */

/**
 * The buyer's overage, as pieces.
 *
 * PER LINE, not on the order total, because that is what the client described
 * ("calculates this percentage based on the PO Quantity for each size and
 * color") and because the two differ: rounding each line up and summing is not
 * the same as rounding the sum. Their own worked example shows it — 500 pieces
 * at 5% reads as 24 in the brief rather than 25, which is what per-line
 * rounding across a split order produces. The line is the unit the buyer's
 * tolerance is agreed on, so the line is where it is applied.
 */
export function excessQty(qty: number, excessPct: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(excessPct)) return 0;
  if (qty <= 0 || excessPct <= 0) return 0;
  return Math.ceil((qty * excessPct) / 100);
}

/**
 * The defect buffer, from the Garment Rejection Rule chosen on the order.
 *
 * A thin wrapper on purpose: `rejectionFor` owns the tier matching, the
 * pieces-vs-percent split (0389) and the rounding, and this must never grow a
 * second copy of any of them. All this adds is the order's own "no rule chosen"
 * case, which the engine cannot know about.
 *
 * Returns null when unanswerable — see the header.
 */
export function projectionQty(
  qty: number,
  tiers: readonly RejectionTier[] | null | undefined,
): number | null {
  if (!tiers || tiers.length === 0) return null;
  return rejectionFor(qty, tiers)?.rejectionQty ?? null;
}

/**
 * What the floor is asked to make.
 *
 * A null projection contributes NOTHING rather than blocking the total. The
 * total is still the best answer available and the operator can still read it;
 * the dash in the Projection column is what says the buffer is unanswered. A
 * blank Total would hide the three figures that ARE known.
 */
export function totalProductionQty(
  line: ApprovalLine,
  excessPct: number,
  tiers: readonly RejectionTier[] | null | undefined,
): number {
  const qty = Number.isFinite(line.qty) ? line.qty : 0;
  const approval = Number.isFinite(line.approvalQty) ? line.approvalQty : 0;
  return qty + excessQty(qty, excessPct) + approval + (projectionQty(qty, tiers) ?? 0);
}

/**
 * The same total, but it REFUSES rather than guesses — for a consumer that will
 * spend money on the answer.
 *
 * `totalProductionQty` above treats a null projection as contributing 0, and on
 * the Approval Qty tab that is right: the dash sitting in the Projection column
 * beside it is what says the buffer is unanswered, and a blank Total would hide
 * three figures that are known.
 *
 * NOTHING SITS BESIDE THE NUMBER ONCE IT LEAVES THAT TAB. A Material BOM
 * multiplies this by a per-garment ratio and stores the result as the quantity a
 * purchase order is checked against; a report sums it. In those places a rule
 * that was chosen and then failed to match any tier produces a plausible total
 * with no dash anywhere near it — the operator has no way to learn that the
 * defect buffer they configured contributed nothing. That is the "an empty
 * report reads as a real answer" failure AGENTS.md names, one step removed.
 *
 * So the distinction the tab can afford to blur is made explicit here:
 *
 *   ruleChosen === false  → computes. No rule is a legitimate zero buffer, and
 *                           it is the state every existing order is in.
 *   ruleChosen === true,
 *     tiers leave a gap   → refuses, naming the reason.
 *
 * `totalProductionQty` is deliberately left exactly as it was. The amendment
 * screen's behaviour must not change: this is an addition for a new consumer,
 * not a correction of an old one.
 */
export type ProductionTarget =
  | { qty: number; reason?: undefined }
  | { qty: null; reason: "projection-gap" };

export function productionTarget(
  line: ApprovalLine,
  excessPct: number,
  tiers: readonly RejectionTier[] | null | undefined,
  ruleChosen: boolean,
): ProductionTarget {
  const qty = Number.isFinite(line.qty) ? line.qty : 0;
  const approval = Number.isFinite(line.approvalQty) ? line.approvalQty : 0;
  const projection = projectionQty(qty, tiers);

  // A rule was named on the order and the engine could not place this quantity
  // in any tier. The ladder has a hole in it; that is a rule to fix, not a
  // buffer of zero. Refusing here is what puts the operator in front of it.
  if (ruleChosen && projection == null) return { qty: null, reason: "projection-gap" };

  return { qty: qty + excessQty(qty, excessPct) + approval + (projection ?? 0) };
}
