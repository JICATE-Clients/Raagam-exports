import { requirePermission, can } from "@/lib/auth/server";
import {
  getTaDepartmentAssigns,
  getTaDeptAssignFormData,
} from "@/lib/orders/ta-department-assign/service";
import { TaDepartmentAssignScreen } from "./ta-department-assign-screen";

export default async function TaDepartmentAssignPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getTaDepartmentAssigns(),
      getTaDeptAssignFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return (
    <TaDepartmentAssignScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
