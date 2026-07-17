import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listIssuedPpmsWithReceiptTotals } from "@/lib/planning/extras-service";
import { PpmReceiptsClient } from "./ppm-receipts-client";

export default async function PpmReceiptsPage() {
  await requirePermission("planning", "view");
  const [rows, canEdit] = await Promise.all([
    listIssuedPpmsWithReceiptTotals(),
    can("planning", "edit"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Garmenting PPM Receipt Completion"
        description="Close out an issued PPM's receipts as complete — records the completion and marks the PPM received."
      />
      <PpmReceiptsClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
