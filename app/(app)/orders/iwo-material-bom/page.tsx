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

  const [tasks, data, canCreate, canEdit, canDelete] = await Promise.all([
    listIwoMaterialBomTasks(),
    getIwoMaterialBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return <IwoMaterialBomScreen tasks={tasks} data={data} perms={{ canCreate, canEdit, canDelete }} />;
}
