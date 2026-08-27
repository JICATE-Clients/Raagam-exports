import { requirePermission, can } from "@/lib/auth/server";
import { getBudgetFormData, listOrderBudgets } from "@/lib/orders/budget/service";
import { BudgetScreen } from "./budget-screen";

/**
 * Orders ▸ Budgeting — step 5 of the client's order flow.
 *
 * ONE LIST, not two, and the difference from the three screens before it is the
 * point: Material BOM, Fabric BOM and Fabric Plan each list ORDERS, because
 * every confirmed order needs one of each and an order without one has to be
 * visible. A budget GROUPS orders, so "one budget per order" is not a thing to
 * be pending about — which orders to group is the operator's judgement, and a
 * queue that pre-empted it would be inventing the grouping.
 *
 * The orders are still loaded, as options with their values already computed
 * (`listBudgetableOrders`), so the operator can see what each one is worth and
 * whether another budget already covers it before picking.
 */
export default async function BudgetsPage() {
  await requirePermission("orders", "view");

  const [budgets, data, canCreate, canEdit, canDelete] = await Promise.all([
    listOrderBudgets(),
    getBudgetFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <BudgetScreen
      budgets={budgets}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
