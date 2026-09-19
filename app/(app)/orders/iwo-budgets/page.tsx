import { requirePermission, can } from "@/lib/auth/server";
import { getIwoBudgetFormData, listIwoBudgetTasks } from "@/lib/orders/iwo-budget/service";
import { IwoBudgetScreen } from "./iwo-budget-screen";

/**
 * Orders ▸ Order Execution ▸ IWO Budget — the budget of an Internal Work Order,
 * pulled from its BOM (0594; client audio 2026-09-19). The list and the editor
 * are one route, switched by client state, as on the IWO BOM screens.
 */
export default async function IwoBudgetPage() {
  await requirePermission("orders", "view");

  const [tasks, data, canCreate, canEdit, canDelete] = await Promise.all([
    listIwoBudgetTasks(),
    getIwoBudgetFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return <IwoBudgetScreen tasks={tasks} data={data} perms={{ canCreate, canEdit, canDelete }} />;
}
