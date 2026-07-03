import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listJobOrders, getOrders } from "@/lib/production/extras-service";
import { JobOrdersClient } from "./job-orders-client";

export default async function JobOrdersPage() {
  await requirePermission("production", "view");
  const [rows, orders, canCreate, canExport] = await Promise.all([
    listJobOrders(),
    getOrders(),
    can("production", "create"),
    can("production", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Production Job Orders"
        description="Internal production jobs (stage-from → stage-to) with component details."
      />
      <JobOrdersClient rows={rows} orders={orders} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
