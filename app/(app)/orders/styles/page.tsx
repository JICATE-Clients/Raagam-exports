import { requirePermission, can } from "@/lib/auth/server";
import { getGarmentStyles, getStyleFormData } from "@/lib/orders/styles/service";
import { StyleMasterScreen } from "./style-master-screen";

export default async function StylesPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getGarmentStyles(),
      getStyleFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return (
    <StyleMasterScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
