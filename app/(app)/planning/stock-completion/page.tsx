import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listStockCompletions, getOrdersForPicker } from "@/lib/planning/extras-service";
import { StockCompletionClient } from "./stock-completion-client";

export default async function StockCompletionPage() {
  await requirePermission("planning", "view");
  const [rows, orders, canCreate, canEdit, canDelete] = await Promise.all([
    listStockCompletions(),
    getOrdersForPicker(),
    can("planning", "create"),
    can("planning", "edit"),
    can("planning", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Completion"
        description="Close out planned stock for an order by recording the completed quantity."
      />
      <StockCompletionClient
        rows={rows}
        orders={orders}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
