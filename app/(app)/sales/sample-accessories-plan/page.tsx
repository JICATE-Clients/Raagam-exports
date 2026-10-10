import { requirePermission, can } from "@/lib/auth/server";
import { getIwoMaterialBomFormData, listIwoMaterialBomTasks } from "@/lib/orders/iwo-material-bom/service";
import { IwoMaterialBomScreen } from "@/app/(app)/orders/iwo-material-bom/iwo-material-bom-screen";

/**
 * Sample ▸ Accessories Plan (user 2026-10-09) — the IWO Accessories Plan, same
 * screen and same logic, over the SAMPLE work orders only (0704 `is_sample`).
 * The plan is the one record per work order Orders ▸ IWO Accessories Plan also
 * opens, so the IWO Budget and the PO ceiling read it unchanged.
 *
 * The page answers to the Sample row (`sales:view`); writes are work-order
 * writes, so Create / Edit / Delete are the Orders permissions the IWO actions
 * check. The Colour and Size pickers edit a master list, hence `masters`.
 */
export default async function SampleAccessoriesPlanPage() {
  await requirePermission("sales", "view");

  const [tasks, data, canCreate, canEdit, canDelete, mCreate, mEdit] = await Promise.all([
    listIwoMaterialBomTasks({ sampleOnly: true }),
    getIwoMaterialBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    can("masters", "create"),
    can("masters", "edit"),
  ]);

  return (
    <IwoMaterialBomScreen
      sample
      tasks={tasks}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
