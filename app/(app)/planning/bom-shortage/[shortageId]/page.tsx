import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getBomShortage } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomStatus } from "@/lib/planning/bom-types";
import { BomShortageDetail } from "./bom-shortage-detail";

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

export default async function BomShortageDetailPage({
  params,
}: {
  params: Promise<{ shortageId: string }>;
}) {
  await requirePermission("planning", "view");
  const { shortageId } = await params;

  const [shortage, canEdit, canDelete, canApprove] = await Promise.all([
    getBomShortage(shortageId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!shortage) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={shortage.code ?? "BOM Shortage"}
        description={`Customer: ${shortage.customer_name ?? "\u2014"} \u00b7 Order: ${shortage.order_code ?? "\u2014"} \u00b7 ${fmtDate(shortage.req_date)}`}
        actions={
          <StatusPill tone={bomStatusTone(shortage.status)}>
            {BOM_STATUS_LABELS[shortage.status]}
          </StatusPill>
        }
      />

      <BomShortageDetail
        shortage={shortage}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
