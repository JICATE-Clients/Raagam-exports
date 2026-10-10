import { requirePermission, can } from "@/lib/auth/server";
import { getIwoFabricBomFormData, listIwoFabricBomTasks } from "@/lib/orders/iwo-fabric-bom/service";
import { IwoFabricBomScreen } from "@/app/(app)/orders/iwo-fabric-bom/iwo-fabric-bom-screen";

/**
 * Sample ▸ Fabric Plan (user 2026-10-09) — the IWO Fabric Plan, same screen and
 * same logic, over the SAMPLE work orders only (0704 `is_sample`). Not a copy:
 * the plan is the one record per work order that Orders ▸ IWO Fabric Plan also
 * opens, so the Fabric IW that Sample ▸ Grouping raises has exactly one plan,
 * and the IWO Budget and the PO ceiling read it unchanged.
 *
 * The page answers to the Sample row (`sales:view`); every write is still a
 * work-order write, so Create / Edit / Delete are the Orders permissions the
 * IWO actions themselves check.
 */
export default async function SampleFabricPlanPage() {
  await requirePermission("sales", "view");

  const [tasks, data, canCreate, canEdit, canDelete] = await Promise.all([
    listIwoFabricBomTasks({ sampleOnly: true }),
    getIwoFabricBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return <IwoFabricBomScreen sample tasks={tasks} data={data} perms={{ canCreate, canEdit, canDelete }} />;
}
