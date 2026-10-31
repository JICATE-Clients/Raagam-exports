import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listRateAmendments, getPosWithLines } from "@/lib/purchase/extras-service";
import { RateAmendmentsClient } from "./rate-amendments-client";

export default async function RateAmendmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const sp = await searchParams;
  const [rows, pos, canCreate, canEdit, canApprove] = await Promise.all([
    listRateAmendments(),
    getPosWithLines(),
    can("materials_purchase", "create"),
    can("materials_purchase", "edit"),
    can("materials_purchase", "approve"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="PO Rate Amendments"
        description="Revise a purchase-order line rate. Submit sends it to the MD in My Approvals; the approve applies the rate, GST and the PO total."
      />
      <RateAmendmentsClient rows={rows} pos={pos} canCreate={canCreate} canEdit={canEdit} canApprove={canApprove} initialPoId={sp.po ?? null} />
    </div>
  );
}
