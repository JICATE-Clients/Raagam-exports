import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listInspections, getOrders } from "@/lib/production/extras-service";
import { InspectionsClient } from "./inspections-client";

export default async function InspectionsPage() {
  await requirePermission("production", "view");
  const [rows, orders, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    listInspections(),
    getOrders(),
    can("production", "create"),
    can("production", "edit"),
    can("production", "delete"),
    can("production", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Inspections" description="Final QC inspection of order lots (pass / fail / rework)." />
      <InspectionsClient rows={rows} orders={orders} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} canExport={canExport} />
    </div>
  );
}
