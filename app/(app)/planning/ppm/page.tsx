import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPpmIssues, getOrdersForPicker } from "@/lib/planning/extras-service";
import { PpmClient } from "./ppm-client";

export default async function PpmPage() {
  await requirePermission("planning", "view");
  const [rows, orders, canCreate] = await Promise.all([
    listPpmIssues(),
    getOrdersForPicker(),
    can("planning", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Issue PPM"
        description="Issue production-planning materials for garment production, with line-wise receipts."
      />
      <PpmClient rows={rows} orders={orders} canCreate={canCreate} />
    </div>
  );
}
