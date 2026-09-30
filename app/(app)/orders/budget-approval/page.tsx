import { requirePermission, can } from "@/lib/auth/server";
import { listBudgetsForApproval, listOrderBudgets } from "@/lib/orders/budget/service";
import { BudgetApprovalScreen } from "./budget-approval-screen";

/**
 * Orders ▸ Approval — step 6 of the client's order flow.
 *
 * A QUEUE OVER `order_budgets.status`, never a second document. The rows are the
 * queue and `budgets` carries the full documents so opening one shows the
 * figures without a second round trip — an approver reads the whole thing before
 * signing, so there is no version of this screen that does not need them.
 *
 * `canApprove` is `orders:approve`, which `lib/auth/types.ts` has declared since
 * 0001 and which nothing has ever used: every other workflow here gates on
 * `edit`, which grants approval to everybody who can type in the document. 0428
 * seeds the permission row and grants it to no role — who may approve is the
 * client's decision, made on the Roles screen.
 */
export default async function BudgetApprovalPage({
  searchParams,
}: {
  /** `?open=<budget id>` — the approval notice's link opens THAT budget
   *  (2026-09-30); it used to land on the list, leaving the MD to find it. */
  searchParams: Promise<{ open?: string }>;
}) {
  await requirePermission("orders", "view");
  const { open } = await searchParams;

  const [rows, budgets, canApprove, canEdit] = await Promise.all([
    listBudgetsForApproval(),
    listOrderBudgets(),
    can("orders", "approve"),
    can("orders", "edit"),
  ]);

  return (
    <BudgetApprovalScreen
      rows={rows}
      budgets={budgets}
      canApprove={canApprove}
      canEdit={canEdit}
      // Only an id this approver can actually see opens; anything else is the list.
      initialOpenId={open && budgets.some((b) => b.id === open) ? open : null}
    />
  );
}
