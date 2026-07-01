import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getGrn, getGrnLines } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import { PostGrnButton } from "./_components/post-grn-button";
import type { GrnLineWithPo } from "@/lib/purchase/grn-service";
import type { QcStatus } from "@/lib/purchase/types";

const qcTone: Record<QcStatus, "success" | "warning" | "danger" | "neutral"> =
  {
    passed: "success",
    partial: "warning",
    failed: "danger",
    pending: "neutral",
  };

const qcLabel: Record<QcStatus, string> = {
  passed: "Passed",
  partial: "Partial",
  failed: "Failed",
  pending: "Pending",
};

const lineColumns: Column<GrnLineWithPo>[] = [
  {
    header: "PO",
    cell: (r) => (
      <span className="text-xs text-muted-foreground">{r.po_code ?? "—"}</span>
    ),
  },
  { header: "Description", cell: (r) => r.description },
  {
    header: "Received",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{fmtNumber(r.received_qty)}</span>
    ),
  },
  {
    header: "Accepted",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{fmtNumber(r.accepted_qty)}</span>
    ),
  },
  {
    header: "Rejected",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{fmtNumber(r.rejected_qty)}</span>
    ),
  },
  {
    header: "QC",
    cell: (r) => (
      <StatusPill tone={qcTone[r.qc_status]}>{qcLabel[r.qc_status]}</StatusPill>
    ),
  },
  {
    header: "Rejection Reason",
    cell: (r) => r.rejection_reason ?? "—",
  },
];

export default async function GrnDetailPage({
  params,
}: {
  params: Promise<{ grnId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { grnId } = await params;

  const [grn, lines] = await Promise.all([getGrn(grnId), getGrnLines(grnId)]);
  if (!grn) notFound();

  const isDraft = grn.status === "draft";

  return (
    <div className="space-y-4">
      <PageHeader
        title={grn.code ?? "GRN"}
        description={`Goods Receipt Note — ${isDraft ? "Draft" : "Posted"}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={isDraft ? "warning" : "success"}>
              {isDraft ? "Draft" : "Posted"}
            </StatusPill>
            {isDraft && <PostGrnButton grnId={grnId} />}
            <Link
              href="/purchase/grn"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to list
            </Link>
          </div>
        }
      />

      {/* GRN header card */}
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="mt-0.5 font-medium">{grn.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd className="mt-0.5">{grn.vendors?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="mt-0.5">{fmtDate(grn.grn_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 text-muted-foreground">
                {grn.notes ?? "—"}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Lines ({lines.length})</CardTitle>
          {isDraft && (
            <span className="text-xs text-warning">
              Draft — post to update PO received quantities
            </span>
          )}
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={lineColumns}
            rows={lines}
            getKey={(r) => r.id}
            empty="No lines on this GRN."
          />
        </CardBody>
      </Card>

      {isDraft && (
        <p className="text-sm text-muted-foreground">
          Once posted, this GRN is read-only and PO quantities will be updated.
        </p>
      )}
    </div>
  );
}
