import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDueDateConfirmations } from "@/lib/orders/booking-service";
import { DueDateClient } from "./due-date-client";

export default async function DueDateConfirmationsPage() {
  await requirePermission("orders", "view");
  const rows = await listDueDateConfirmations();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Due Date Confirmations"
        description="Confirm or update delivery dates for order line items."
      />
      <DueDateClient rows={rows} />
    </div>
  );
}
