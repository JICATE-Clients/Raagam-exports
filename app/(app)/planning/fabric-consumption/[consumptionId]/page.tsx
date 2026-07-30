import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getFabricConsumption } from "@/lib/planning/material-planning-service";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { FabricConsumptionDetail } from "./fabric-consumption-detail";

const STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function statusTone(status: MpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

export default async function FabricConsumptionDetailPage({
  params,
}: {
  params: Promise<{ consumptionId: string }>;
}) {
  await requirePermission("planning", "view");
  const { consumptionId } = await params;

  const [consumption, canEdit, canDelete, canApprove] = await Promise.all([
    getFabricConsumption(consumptionId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!consumption) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={consumption.code ?? "Fabric Consumption"}
        description={`HSN: ${consumption.hsn_code ?? "\u2014"} \u00b7 Size Group: ${consumption.size_group_no ?? "\u2014"}`}
        actions={
          <StatusPill tone={statusTone(consumption.status)}>
            {STATUS_LABELS[consumption.status]}
          </StatusPill>
        }
      />
      <FabricConsumptionDetail
        consumption={consumption}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
