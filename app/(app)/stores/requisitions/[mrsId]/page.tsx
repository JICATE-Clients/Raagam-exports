import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getRequisition,
  getRequisitionLines,
  getItems,
} from "@/lib/stores/extras-service";
import { MRS_STATUS_LABELS, type MrsStatus } from "@/lib/stores/extras-types";
import { RequisitionDetail } from "./requisition-detail";

function tone(s: MrsStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "submitted":
      return "info";
    case "approved":
      return "warning";
    case "issued":
      return "success";
    case "rejected":
    case "cancelled":
      return "danger";
  }
}

export default async function RequisitionDetailPage({
  params,
}: {
  params: Promise<{ mrsId: string }>;
}) {
  await requirePermission("stores", "view");
  const { mrsId } = await params;
  const [doc, lines, items, canEdit, canApprove, canDelete] = await Promise.all([
    getRequisition(mrsId),
    getRequisitionLines(mrsId),
    getItems(),
    can("stores", "edit"),
    can("stores", "approve"),
    can("stores", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "Requisition"}
        description={`${doc.department} department`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{MRS_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/stores/requisitions" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Department</dt>
              <dd className="mt-0.5 font-medium">{doc.department}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Required date</dt>
              <dd className="mt-0.5 tabular-nums">{fmtDate(doc.required_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{MRS_STATUS_LABELS[doc.status]}</dd>
            </div>
            {doc.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{doc.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>
      <RequisitionDetail
        docId={mrsId}
        status={doc.status}
        lines={lines}
        items={items}
        canEdit={canEdit}
        canApprove={canApprove}
        canDelete={canDelete}
      />
    </div>
  );
}
