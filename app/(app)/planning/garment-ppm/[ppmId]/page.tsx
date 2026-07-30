import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getGarmentPpm } from "@/lib/planning/ppm-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { GarmentPpmDetail } from "./garment-ppm-detail";

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

export default async function GarmentPpmDetailPage({
  params,
}: {
  params: Promise<{ ppmId: string }>;
}) {
  await requirePermission("planning", "view");
  const { ppmId } = await params;

  const [ppm, canEdit, canDelete, canApprove] = await Promise.all([
    getGarmentPpm(ppmId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!ppm) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={ppm.code ?? "Garment PPM"}
        description={`Customer: ${ppm.customer_name ?? "\u2014"} \u00b7 SC No: ${ppm.sc_no ?? "\u2014"} \u00b7 ${fmtDate(ppm.ppm_date)}`}
        actions={
          <StatusPill tone={ppmStatusTone(ppm.status)}>
            {PPM_STATUS_LABELS[ppm.status]}
          </StatusPill>
        }
      />

      <GarmentPpmDetail
        ppm={ppm}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
