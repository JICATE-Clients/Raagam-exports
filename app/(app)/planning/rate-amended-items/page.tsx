import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listRateAmendedItems } from "@/lib/planning/rate-detail-service";
import { RateAmendedItemsClient } from "./rate-amended-items-client";

export default async function RateAmendedItemsPage() {
  await requirePermission("planning", "view");
  const rows = await listRateAmendedItems();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Rate Detail for Amended Items"
        description="Items whose rate was formally amended — unioned from PO and process rate amendments."
      />
      <RateAmendedItemsClient rows={rows} />
    </div>
  );
}
