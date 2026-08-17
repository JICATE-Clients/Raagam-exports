import { requirePermission, can } from "@/lib/auth/server";
import {
  getFabricBomFormData,
  listFabricBomTasks,
  listFabricBoms,
} from "@/lib/orders/fabric-bom/service";
import { FabricBomScreen } from "./fabric-bom-screen";

/**
 * Orders ▸ Fabric BOM — step 5 of the client's order flow.
 *
 * TWO LISTS, and the distinction is the point of the screen — the same call
 * Material BOM's page records. `tasks` is one row per confirmed garment ORDER,
 * marked Pending / Draft / Updated / Recalculate: it is the merchandiser's work
 * queue, and an order with no BOM has to appear in it or "Pending" could never
 * be shown for the case it describes. `boms` is the documents themselves, so
 * clicking a queue row can open the one that exists.
 */
export default async function FabricBomPage() {
  await requirePermission("orders", "view");

  const [tasks, boms, data, canCreate, canEdit, canDelete] = await Promise.all([
    listFabricBomTasks(),
    listFabricBoms(),
    getFabricBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  // No wrapper here — the screen renders its own PageHeader, and the editor is
  // an overlay that covers the whole viewport.
  return (
    <FabricBomScreen
      tasks={tasks}
      boms={boms}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
