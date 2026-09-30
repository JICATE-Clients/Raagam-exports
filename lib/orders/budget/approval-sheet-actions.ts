"use server";

import { can } from "@/lib/auth/server";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getOrderBudget } from "@/lib/orders/budget/service";
import { getRevisionComparison } from "@/lib/orders/order-amendments/service";
import { breakdownOfBudget } from "@/lib/approvals/budget-breakdown";

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
    return { panel: { run: null, verdict: null, timeline: [], names: {} }, revision: null, breakdown: null };
  }
  /* THE COST CHART RIDES THE SAME ACTION (2026-09-29) — same reason as the
     comparison: a second action would queue behind this one. It reads the
     budget this action already reads, and V0's frozen lines, which only the
     server has (the chart splits the fabric's job-work out of V0's Fabric). */
  const budget = getOrderBudget(budgetId);
  const [panel, revision, breakdown] = await Promise.all([
    getApprovalPanel(WORKFLOWS.order_budget.subjectTable, budgetId),
    budget.then((b) => (b && b.status === "submitted" ? getRevisionComparison(b) : null)).catch(() => null),
    budget.then((b) => (b ? breakdownOfBudget(b) : null)).catch(() => null),
  ]);
  return { panel, revision, breakdown };
}
