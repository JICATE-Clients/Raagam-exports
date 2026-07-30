import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getMaterialRate } from "@/lib/planning/material-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { MaterialRateDetail } from "./material-rate-detail";

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

export default async function MaterialRateDetailPage({
  params,
}: {
  params: Promise<{ rateId: string }>;
}) {
  await requirePermission("planning", "view");
  const { rateId } = await params;

  const [rate, canEdit, canDelete, canApprove] = await Promise.all([
    getMaterialRate(rateId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!rate) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={rate.code ?? "Material Rate"}
        description={`Customer: ${rate.customer_name ?? "\u2014"} \u00b7 Group: ${rate.group_no ?? "\u2014"} \u00b7 ${fmtDate(rate.entry_date)}`}
        actions={
          <StatusPill tone={statusTone(rate.status)}>
            {STATUS_LABELS[rate.status]}
          </StatusPill>
        }
      />
      <MaterialRateDetail
        rate={rate}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
