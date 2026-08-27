import { requirePermission, can } from "@/lib/auth/server";
import {
  getMbaFormData,
  listBomCopySources,
  listMaterialBomAmendments,
  listMaterialBomTasks,
} from "@/lib/orders/material-bom-amendment/service";
import { MbaMasterScreen } from "./mba-master-screen";

/**
 * Orders ▸ Material BOM — step 2 of the six-step garment order flow. It was
 * step 3 until Style left the menu on 2026-08-25 (the style is entered on the
 * order line now); `lib/nav/module-groups.ts` holds the sequence.
 *
 * TWO LISTS, and the distinction is the point of the screen. `tasks` is one row
 * per confirmed garment ORDER, marked Pending / Draft / Updated / Recalculate:
 * it is the merchandiser's work queue, and an order with no BOM has to appear in
 * it or "Pending" could never be shown for the case it describes. `boms` is the
 * documents themselves, so clicking a queue row can open the one that exists.
 */
export default async function MaterialBomPage() {
  await requirePermission("orders", "view");

  const [tasks, boms, copySources, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      listMaterialBomTasks(),
      listMaterialBomAmendments(),
      listBomCopySources(),
      getMbaFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  // No wrapper and no PageHeader here — the screen renders its own, and the
  // editor is an overlay that covers the whole viewport.
  return (
    <MbaMasterScreen
      tasks={tasks}
      boms={boms}
      copySources={copySources}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
