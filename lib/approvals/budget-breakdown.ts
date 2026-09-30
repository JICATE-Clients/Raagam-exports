import "server-only";
import { getOrderBudget } from "@/lib/orders/budget/service";
import { budgetTotals, generalSummary } from "@/lib/orders/budget/totals";
import { compareToBaseline, fabricProcessAmountOf, type BudgetBaseline } from "@/lib/orders/budget/amendment";
import { lineInputOf, orderInputsOfSnapshot } from "@/lib/orders/budget/figures";
import {
  baselineRecordOf,
  breakdownOfBaseline,
  breakdownOfTotals,
  type BudgetBreakdown,
} from "@/lib/orders/budget/breakdown";
import { firstBaselineOf } from "@/lib/orders/order-amendments/service";

/**
 * THE APPROVAL CHART'S FIGURES (client 2026-09-29) — phone card and desktop
 * sheet alike.
 *
 * `current` is the budget AS SUBMITTED — its stored lines over the SNAPSHOT
 * orders, the same two inputs the desktop approval sheet builds its totals
 * from (`budget-approval-screen.tsx`, 0428: "the approver must see the figures
 * the author submitted"). Never a live re-read: an order edited after submit
 * would otherwise move the chart under an approval nobody re-submitted.
 *
 * `original` is V0 — the baseline the order's FIRST revision froze
 * (`firstBaselineOf`, the one query `getRevisionComparison` also uses), read
 * through `compareToBaseline` so an old baseline is regrouped. Null for a
 * budget that has never been revised: there is nothing to compare against.
 *
 * Pure arithmetic once the budget is in hand: the approval cards compute it
 * for the whole queue from their one batch read (V0 handed in), the desktop
 * sheet for the one budget it opens.
 */
export type BudgetBreakdownPair =
  | { ok: true; current: BudgetBreakdown; original: BudgetBreakdown | null }
  | { ok: false; refused: string };

/**
 * The breakdown of a budget the caller already holds (the desktop sheet, the
 * approval cards — `loadOrderApprovalCards`). `v0` may be handed in by a caller that read every order's
 * first baseline in one query (the cards); `undefined` reads it here.
 */
export async function breakdownOfBudget(
  budget: NonNullable<Awaited<ReturnType<typeof getOrderBudget>>>,
  v0?: BudgetBaseline | null,
): Promise<BudgetBreakdownPair> {
  try {
    const totals = budgetTotals((budget.lines ?? []).map(lineInputOf), orderInputsOfSnapshot(budget.orders ?? []));
    // Cut Qty only feeds cost per piece, which the chart does not draw.
    const general = generalSummary(totals, { refused: "Not needed for the chart" });

    type Rev = { outcome?: string; baseline: unknown; garment_order_id?: string | null };
    const open = ((budget.revisions ?? []) as unknown as Rev[]).find((r) => r.outcome === "open");
    let original: BudgetBreakdown | null = null;
    if (open) {
      const first =
        v0 !== undefined
          ? v0
          : open.garment_order_id
            ? await firstBaselineOf(open.garment_order_id)
            : null;
      const base = first || ((open.baseline as BudgetBaseline | null) ?? null);
      if (base) {
        original = breakdownOfBaseline(
          baselineRecordOf(compareToBaseline(base, general)),
          fabricProcessAmountOf(base.lines),
        );
      }
    }
    return { ok: true, current: breakdownOfTotals(totals), original };
  } catch (e) {
    return { ok: false, refused: e instanceof Error ? e.message : "The budget's figures could not be worked out" };
  }
}
