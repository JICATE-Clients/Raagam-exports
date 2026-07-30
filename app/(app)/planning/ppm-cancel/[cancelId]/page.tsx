import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getPpmCancel } from "@/lib/planning/ppm-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { CANCEL_TYPE_LABELS } from "@/lib/planning/ppm-types";
import { PpmCancelDetail } from "./ppm-cancel-detail";

const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppmStatusTone(status: PpmStatus): StatusTone {
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

export default async function PpmCancelDetailPage({
  params,
}: {
  params: Promise<{ cancelId: string }>;
}) {
  await requirePermission("planning", "view");
  const { cancelId } = await params;

  const [cancel, canEdit, canDelete, canApprove] = await Promise.all([
    getPpmCancel(cancelId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!cancel) notFound();

  const cancelTypeLabel = CANCEL_TYPE_LABELS[cancel.cancel_type] ?? cancel.cancel_type;

  return (
    <div className="space-y-4">
      <PageHeader
        title={cancel.code ?? "PPM Cancel"}
        description={`${cancelTypeLabel} \u00b7 Customer: ${cancel.customer_name ?? "\u2014"} \u00b7 ${fmtDate(cancel.cancel_date)}`}
        actions={
          <StatusPill tone={ppmStatusTone(cancel.status)}>
            {PPM_STATUS_LABELS[cancel.status]}
          </StatusPill>
        }
      />

      <PpmCancelDetail
        cancel={cancel}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
