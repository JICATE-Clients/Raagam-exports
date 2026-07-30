import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getPpmCompletion } from "@/lib/planning/ppm-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { PpmCompletionDetail } from "./ppm-completion-detail";

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

export default async function PpmCompletionDetailPage({
  params,
}: {
  params: Promise<{ completionId: string }>;
}) {
  await requirePermission("planning", "view");
  const { completionId } = await params;

  const [completion, canEdit, canDelete, canApprove] = await Promise.all([
    getPpmCompletion(completionId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!completion) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={completion.code ?? "PPM Completion"}
        description={`Customer: ${completion.customer_name ?? "\u2014"} \u00b7 ${fmtDate(completion.entry_date)}`}
        actions={
          <StatusPill tone={ppmStatusTone(completion.status)}>
            {PPM_STATUS_LABELS[completion.status]}
          </StatusPill>
        }
      />

      <PpmCompletionDetail
        completion={completion}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
