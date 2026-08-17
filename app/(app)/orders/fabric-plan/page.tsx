import { requirePermission, can } from "@/lib/auth/server";
import {
  getFabricPlanFormData,
  listFabricPlanTasks,
  listFabricPlans,
} from "@/lib/orders/fabric-plan/service";
import { FabricPlanScreen } from "./fabric-plan-screen";

/**
 * Orders ▸ Fabric Plan — step 6 of the client's order flow.
 *
 * TWO LISTS, the same shape both BOM screens use: `tasks` is one row per
 * confirmed garment ORDER (so an order whose fabric has never been routed is
 * visible rather than absent), `plans` is the documents, so clicking a queue row
 * can open the one that exists.
 *
 * The FABRICS are not loaded here. They come from the order's Fabric BOM and are
 * fetched per order when one is picked — shipping every confirmed order's BOM to
 * the browser to use one of them is the payload both BOM screens already decline
 * to send.
 */
export default async function FabricPlanPage() {
  await requirePermission("orders", "view");

  const [tasks, plans, data, canCreate, canEdit, canDelete] = await Promise.all([
    listFabricPlanTasks(),
    listFabricPlans(),
    getFabricPlanFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <FabricPlanScreen
      tasks={tasks}
      plans={plans}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
