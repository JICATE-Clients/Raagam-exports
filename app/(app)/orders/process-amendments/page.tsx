import { requirePermission, can } from "@/lib/auth/server";
import {
  getProcessAmendments,
  getGpaFormData,
} from "@/lib/orders/process-amendments/service";
import { ProcessAmendmentScreen } from "./process-amendment-screen";

export default async function ProcessAmendmentsPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete] = await Promise.all([
    getProcessAmendments(),
    getGpaFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <ProcessAmendmentScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
