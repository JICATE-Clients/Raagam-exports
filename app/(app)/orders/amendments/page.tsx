import { requirePermission, can } from "@/lib/auth/server";
import { getAmendments, getAmendmentFormData } from "@/lib/orders/amendments/service";
import { AmendmentScreen } from "./amendment-screen";

export default async function AmendmentsPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getAmendments(),
      getAmendmentFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return (
    <AmendmentScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
