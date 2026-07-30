import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getProductionPlan } from "@/lib/planning/production-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { PpStatus } from "@/lib/planning/production-planning-types";
import { DATE_TYPE_LABELS } from "@/lib/planning/production-planning-types";
import { ProductionPlanningDetail } from "./production-planning-detail";

const STATUS_LABELS: Record<PpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function statusTone(status: PpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

export default async function ProductionPlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePermission("planning", "view");
  const { planId } = await params;

  const [plan, canEdit, canDelete, canApprove] = await Promise.all([
    getProductionPlan(planId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!plan) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={plan.code ?? "Production Plan"}
        description={`Plan Date: ${fmtDate(plan.plan_date)} \u00b7 Type: ${DATE_TYPE_LABELS[plan.date_type ?? "E"] ?? plan.date_type ?? "\u2014"}`}
        actions={
          <StatusPill tone={statusTone(plan.status)}>
            {STATUS_LABELS[plan.status]}
          </StatusPill>
        }
      />
      <ProductionPlanningDetail
        plan={plan}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
