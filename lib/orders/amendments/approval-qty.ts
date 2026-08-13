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
