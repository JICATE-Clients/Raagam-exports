import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getGarmentBom } from "@/lib/planning/bom-detail-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomStatus } from "@/lib/planning/bom-types";
import { GarmentBomDetail } from "./garment-bom-detail";
import { statusTone } from "@/lib/ui/status-tone";

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
  return statusTone(status);
}

export default async function GarmentBomDetailPage({
  params,
}: {
  params: Promise<{ bomId: string }>;
}) {
  await requirePermission("planning", "view");
  const { bomId } = await params;

  const [bom, canEdit, canDelete, canApprove] = await Promise.all([
    getGarmentBom(bomId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!bom) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={bom.code ?? "Garment BOM"}
        description={`Style: ${bom.style_code ?? "\u2014"} \u00b7 Customer: ${bom.customer_name ?? "\u2014"} \u00b7 ${fmtDate(bom.created_at)}`}
        actions={
          <StatusPill tone={bomStatusTone(bom.status)}>
            {BOM_STATUS_LABELS[bom.status]}
          </StatusPill>
        }
      />

      <GarmentBomDetail
        bom={bom}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
