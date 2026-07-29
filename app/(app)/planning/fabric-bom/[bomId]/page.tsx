import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getFabricBom } from "@/lib/planning/bom-detail-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomStatus } from "@/lib/planning/bom-types";
import { FabricBomDetail } from "./fabric-bom-detail";

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

export default async function FabricBomDetailPage({
  params,
}: {
  params: Promise<{ bomId: string }>;
}) {
  await requirePermission("planning", "view");
  const { bomId } = await params;

  const [bom, canEdit, canDelete, canApprove] = await Promise.all([
    getFabricBom(bomId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!bom) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={bom.code ?? "Fabric BOM"}
        description={`Style: ${bom.style_code ?? "\u2014"} \u00b7 Customer: ${bom.customer_name ?? "\u2014"} \u00b7 ${fmtDate(bom.created_at)}`}
        actions={
          <StatusPill tone={bomStatusTone(bom.status)}>
            {BOM_STATUS_LABELS[bom.status]}
          </StatusPill>
        }
      />

      <FabricBomDetail
        bom={bom}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
