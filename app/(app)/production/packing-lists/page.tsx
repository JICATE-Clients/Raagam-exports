import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPackingLists, getOrders } from "@/lib/production/extras-service";
import { PackingListsClient } from "./packing-lists-client";

export default async function PackingListsPage() {
  await requirePermission("production", "view");
  const [rows, orders, canCreate] = await Promise.all([
    listPackingLists(),
    getOrders(),
    can("production", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Packing Lists" description="Carton-wise packing detail per order." />
      <PackingListsClient rows={rows} orders={orders} canCreate={canCreate} />
    </div>
  );
}
