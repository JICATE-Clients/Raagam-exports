import { requirePermission, can } from "@/lib/auth/server";
import {
  listMaterialBomAmendments,
  getMbaFormData,
} from "@/lib/orders/material-bom-amendment/service";
import { MbaMasterScreen } from "./mba-master-screen";

export default async function MaterialBomAmendmentPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      listMaterialBomAmendments(),
      getMbaFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  // No wrapper and no PageHeader here. The screen renders its own — a
  // `space-y-4` host would break the page-mounted `MasterFullScreen`, which
  // takes `flex-1 min-h-0` and needs a `flex h-full flex-col` parent to divide;
  // and the two modes want different headers (the list's "New Amendment", the
  // editor's "← Back to list"). Same shape as `orders/amendments/page.tsx`.
  return (
    <MbaMasterScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
