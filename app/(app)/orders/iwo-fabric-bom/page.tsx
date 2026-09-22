import { requirePermission, can } from "@/lib/auth/server";
import { getIwoFabricBomFormData, listIwoFabricBomTasks } from "@/lib/orders/iwo-fabric-bom/service";
import { IwoFabricBomScreen } from "./iwo-fabric-bom-screen";

/**
 * Orders ▸ Order Execution ▸ IWO Fabric BOM — the order Fabric BOM duplicated
 * for an Internal Work Order For Yarn or Fabric (0581). The list and the editor
 * are one route, switched by client state, as on the order screen.
 */
export default async function IwoFabricBomPage() {
  await requirePermission("orders", "view");

  const [tasks, data, canCreate, canEdit, canDelete] = await Promise.all([
    listIwoFabricBomTasks(),
    getIwoFabricBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return <IwoFabricBomScreen tasks={tasks} data={data} perms={{ canCreate, canEdit, canDelete }} />;
}
