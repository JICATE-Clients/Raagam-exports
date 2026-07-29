import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getBomTransfer } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { BomTransferDetail } from "./bom-transfer-detail";

type TransferStatus = "draft" | "submitted" | "approved";

const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
};

function transferStatusTone(status: TransferStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
  }
}

export default async function BomTransferDetailPage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  await requirePermission("planning", "view");
  const { transferId } = await params;

  const [transfer, canEdit, canDelete, canApprove] = await Promise.all([
    getBomTransfer(transferId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!transfer) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={transfer.code ?? "BOM Transfer"}
        description={`Customer: ${transfer.customer_name ?? "\u2014"} \u00b7 ${transfer.transfer_from ?? "\u2014"} \u2192 ${transfer.transfer_to ?? "\u2014"} \u00b7 ${fmtDate(transfer.created_at)}`}
        actions={
          <StatusPill tone={transferStatusTone(transfer.status)}>
            {TRANSFER_STATUS_LABELS[transfer.status]}
          </StatusPill>
        }
      />

      <BomTransferDetail
        transfer={transfer}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
