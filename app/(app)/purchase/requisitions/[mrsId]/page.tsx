import Link from "next/link";
import { DocBackLink, DocFacts, DocPrintIcon } from "@/components/purchase/doc-facts";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getRequisition,
  getRequisitionLines,
  getItems,
} from "@/lib/stores/extras-service";
import { MRS_STATUS_LABELS, type MrsStatus } from "@/lib/stores/extras-types";
import { RequisitionDetail } from "./requisition-detail";
import { statusTone } from "@/lib/ui/status-tone";

const TONE_OVERRIDES = {
  // Submitted here is a hand-off that waits on no approver (was info before the shared table, kept).
  submitted: "info",
  // Approved is a step in this document's life, not its end — work still follows it (was warning before the shared table, kept).
  approved: "warning",
  // Issued is this document's completion — the goods or paper have gone (was success before the shared table, kept).
  issued: "success",
} as const;

function tone(s: MrsStatus): StatusTone {
  return statusTone(s, TONE_OVERRIDES);
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
      />
      {/* ONE STRIP, NOT A TITLED CARD (user 2026-11-03, screenshot 4000) — components/purchase/doc-facts.tsx. */}
      <DocFacts
        trailing={
          <>
            <StatusPill tone={tone(doc.status)}>{MRS_STATUS_LABELS[doc.status]}</StatusPill>
            <DocBackLink href="/purchase/requisitions" />
          </>
        }
        facts={[
          { label: "Department", value: doc.department },
          { label: "Required date", value: fmtDate(doc.required_date), mono: true },
          doc.notes ? { label: "Notes", value: <span className="font-normal text-muted-foreground">{doc.notes}</span> } : null,
        ]}
      />
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
