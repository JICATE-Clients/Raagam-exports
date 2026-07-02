import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDespatches, getOrders } from "@/lib/production/extras-service";
import { DespatchClient } from "./despatch-client";

export default async function DespatchPage() {
  await requirePermission("production", "view");
  const [rows, orders, canCreate, canEdit, canDelete] = await Promise.all([
    listDespatches(),
    getOrders(),
    can("production", "create"),
    can("production", "edit"),
    can("production", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Despatch" description="Factory despatch of finished goods → handoff to Logistics." />
      <DespatchClient rows={rows} orders={orders} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
