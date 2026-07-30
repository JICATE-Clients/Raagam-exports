import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getMaterialExcessPlan } from "@/lib/planning/material-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { MaterialExcessPlanDetail } from "./material-excess-plan-detail";

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

export default async function MaterialExcessPlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePermission("planning", "view");
  const { planId } = await params;

  const [plan, canEdit, canDelete, canApprove] = await Promise.all([
    getMaterialExcessPlan(planId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!plan) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={plan.code ?? "Material Excess Plan"}
        description={`Customer: ${plan.customer_name ?? "\u2014"} \u00b7 Group: ${plan.group_no ?? "\u2014"} \u00b7 ${fmtDate(plan.entry_date)}`}
        actions={
          <StatusPill tone={statusTone(plan.status)}>
            {STATUS_LABELS[plan.status]}
          </StatusPill>
        }
      />
      <MaterialExcessPlanDetail
        plan={plan}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
