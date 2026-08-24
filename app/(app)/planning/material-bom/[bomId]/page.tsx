import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getMaterialBom } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomStatus } from "@/lib/planning/bom-types";
import { MaterialBomDetail } from "./material-bom-detail";

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

export default async function MaterialBomDetailPage({
  params,
}: {
  params: Promise<{ bomId: string }>;
}) {
  await requirePermission("planning", "view");
  const { bomId } = await params;

  const [bom, canEdit, canDelete, canApprove] = await Promise.all([
    getMaterialBom(bomId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!bom) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={bom.code ?? "Material BOM"}
        description={`Customer: ${bom.customer_name ?? "—"} · RE No: ${bom.order_code ?? "—"} · ${fmtDate(bom.created_at)}`}
        actions={
          <StatusPill tone={bomStatusTone(bom.status)}>
            {BOM_STATUS_LABELS[bom.status]}
          </StatusPill>
        }
      />

      <MaterialBomDetail
        bom={bom}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
