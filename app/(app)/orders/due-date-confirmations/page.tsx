import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDueDateConfirmations } from "@/lib/orders/booking-service";
import { listOrderOptions } from "@/lib/orders/order-options";
import { DueDateClient } from "./due-date-client";

export default async function DueDateConfirmationsPage() {
  await requirePermission("orders", "view");
  const [rows, orders] = await Promise.all([
    listDueDateConfirmations(),
    listOrderOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Due Date Confirmations"
        description="Confirm or update delivery dates for order line items."
      />
      <DueDateClient rows={rows} orders={orders} />
    </div>
  );
}
