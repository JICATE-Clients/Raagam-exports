import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPurchaseIndents, getOrders } from "@/lib/purchase/extras-service";
import { IndentsClient } from "./indents-client";

export default async function IndentsPage() {
  await requirePermission("materials_purchase", "view");
  const [rows, orders, canCreate] = await Promise.all([
    listPurchaseIndents(),
    getOrders(),
    can("materials_purchase", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Indents"
        description="Department-raised material indents — acknowledge and convert to RFQ/PO."
      />
      <IndentsClient rows={rows} orders={orders} canCreate={canCreate} />
    </div>
  );
}
