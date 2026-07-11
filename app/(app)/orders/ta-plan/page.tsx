import { requirePermission, can } from "@/lib/auth/server";
import { getTaPlans, getTaPlanFormData } from "@/lib/orders/ta-plan/service";
import { TaPlanScreen } from "./ta-plan-screen";

export default async function TaPlanPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete] = await Promise.all([
    getTaPlans(),
    getTaPlanFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <TaPlanScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
