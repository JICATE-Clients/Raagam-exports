import { requirePermission, can } from "@/lib/auth/server";
import { getCadFormData, listCadMarkers, listCadTasks } from "@/lib/orders/cad/service";
import { CadScreen } from "./cad-screen";

/**
 * Orders ▸ CAD Markers — doc/file.md §2.
 *
 * TWO LISTS, and the distinction is the point of the screen — the same call the
 * Fabric BOM's page records. `tasks` is one row per confirmed garment ORDER,
 * marked Pending / Draft / Panels unweighed / Submitted: it is the CAD room's
 * work queue, and an order nobody has measured has to appear in it or "Pending"
 * could never be shown for the case it describes. `markers` is the sheets
 * themselves, so clicking a queue row opens the one that exists.
 *
 * Gated on `orders`, not on a CAD-specific module: adding one is a change to the
 * permission catalog and the role screens. §4 of the spec wants CAD Technicians
 * as a ROLE, and a role granted `orders:edit` reaches this today.
 */
export default async function CadMarkersPage() {
  await requirePermission("orders", "view");

  const [tasks, markers, data, canCreate, canEdit, canDelete] = await Promise.all([
    listCadTasks(),
    listCadMarkers(),
    getCadFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  // No wrapper here — the screen renders its own PageHeader, and the editor is
  // an overlay that covers the whole viewport.
  return (
    <CadScreen
      tasks={tasks}
      markers={markers}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
