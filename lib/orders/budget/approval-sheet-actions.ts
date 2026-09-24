"use server";

import { can } from "@/lib/auth/server";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getOrderBudget } from "@/lib/orders/budget/service";
import { getRevisionComparison } from "@/lib/orders/order-amendments/service";

/**
 * Everything the Budget Approval sheet reads when it OPENS — the approval
 * panel and, for a revised budget, its Original · Last · Latest comparison —
 * in ONE server action, the two halves in parallel (2026-09-24).
 *
 * WHY HERE AND NOT IN THE PAGE LOADER. The comparison re-derives the whole
 * budget's figures and reads the whole order; the page used to do that for
 * EVERY submitted budget on EVERY render — and a decision's own response
 * re-renders the page, so each Approve paid for the comparisons of budgets
 * nobody had open. Now only the sheet being read pays, once, when opened.
 *
 * ONE ACTION, NOT TWO, because Next runs a client's server actions one after
 * another: a separate comparison action would queue behind the panel's.
 */
export async function loadBudgetApprovalSheet(budgetId: string) {
  if (!(await can("orders", "view"))) {
    return { panel: { run: null, verdict: null, timeline: [], names: {} }, revision: null };
  }
  const [panel, revision] = await Promise.all([
    getApprovalPanel(WORKFLOWS.order_budget.subjectTable, budgetId),
    getOrderBudget(budgetId)
      .then((b) => (b && b.status === "submitted" ? getRevisionComparison(b) : null))
      .catch(() => null),
  ]);
  return { panel, revision };
}
