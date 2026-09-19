import { requirePermission, can } from "@/lib/auth/server";
import { getBudgetFormData, listOrderBudgets } from "@/lib/orders/budget/service";
import { BudgetScreen } from "./budget-screen";

/**
 * Orders ▸ Budgeting — step 5 of the client's order flow.
 *
 * TWO LISTS (user 2026-09-19). First the ORDERS READY TO BUDGET as cards, the
 * way Material BOM and Fabric BOM list theirs (`BudgetQueue`): Order Entry
 * recorded and both BOMs saved, each card saying whether a budget covers it
 * yet. Then the Budgets table. A budget still GROUPS orders, so the queue does
 * not invent a grouping: opening an uncovered card starts a budget with that
 * one order picked, and more can be added in the editor.
 *
 * Both read `listBudgetableOrders`, which already carries each order's value,
 * quantities, BOM readiness and the budget covering it, so the queue costs no
 * extra query.
 */
export default async function BudgetsPage() {
  await requirePermission("orders", "view");

  const [budgets, data, canCreate, canEdit, canDelete, mCreate, mEdit, canApprove] = await Promise.all([
    listOrderBudgets(),
    getBudgetFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    // The Cost Head / Income Head pickers add and rename `config_lookups` rows
    // inline, which is MASTER data — gated on `masters`, as Packing Advice's
    // Warehouse picker is, not on the order permission that opened the screen.
    can("masters", "create"),
    can("masters", "edit"),
    // REOPENING AN APPROVED BUDGET IS THE APPROVER'S ACT (Amendment Protocol):
    // it undoes an approval and unlocks the orders, so it answers to the same
    // permission that granted it — and the RPC refuses anyone else anyway.
    can("orders", "approve"),
  ]);

  return (
    <BudgetScreen
      budgets={budgets}
      data={data}
      perms={{ canCreate, canEdit, canDelete, canApprove }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
