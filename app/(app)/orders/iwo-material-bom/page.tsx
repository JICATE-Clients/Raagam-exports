import { requirePermission, can } from "@/lib/auth/server";
import { getIwoMaterialBomFormData, listIwoMaterialBomTasks } from "@/lib/orders/iwo-material-bom/service";
import { IwoMaterialBomScreen } from "./iwo-material-bom-screen";

/**
 * Orders ▸ Order Execution ▸ IWO Material BOM — the order Material BOM
 * duplicated for an Internal Work Order For Accessories (0584). The list and
 * the editor are one route, switched by client state, as on the order screen.
 */
export default async function IwoMaterialBomPage() {
  await requirePermission("orders", "view");

  const [tasks, data, canCreate, canEdit, canDelete, mCreate, mEdit] = await Promise.all([
    listIwoMaterialBomTasks(),
    getIwoMaterialBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    // The Colour and Size pickers add to / modify a MASTER list in place, so
    // they are gated by the masters permission — the order Material BOM's
    // `masterPerms`, not the orders one (user 2026-09-22: "same concept").
    can("masters", "create"),
    can("masters", "edit"),
  ]);

  return (
    <IwoMaterialBomScreen
      tasks={tasks}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
