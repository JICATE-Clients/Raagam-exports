import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getGrn, getGrnLines, getGrnPaper } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone, TASK_PROGRESS } from "@/lib/ui/status-tone";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/format";
import { PostGrnButton } from "./_components/post-grn-button";
import { LineRejectionFix } from "./_components/line-rejection-fix";
import type { GrnLineWithPo } from "@/lib/purchase/grn-service";
import type { QcStatus } from "@/lib/purchase/types";

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
      <StatusPill tone={statusTone(r.qc_status, TASK_PROGRESS)}>{qcLabel[r.qc_status]}</StatusPill>
    ),
  },
  {
    header: "Rejection Reason",
    // With where the rejected qty went (0780): sent again on this PO, or closed and re-bought.
    cell: (r) =>
      r.rejection_reason
        ? `${r.rejection_reason} · ${r.rejection_action === "return" ? "Rejection" : "Replacement"}`
        : "—",
  },
  {
    header: "Lot No",
    cell: (r) => r.roll_batch_no ?? "—",
  },
  // Where the accepted goods were put (0777); posting books them there (0779).
  { header: "Store", cell: (r) => r.store_name ?? "—" },
  { header: "Bin", cell: (r) => r.bin_code ?? "—" },
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
  // The paper a rejection raised, and the DC a replacement fills (0780).
  const paper = await getGrnPaper(grn);

  const isDraft = grn.status === "draft";

  return (
    <div className="space-y-4">
      <PageHeader
        title={grn.code ?? "GRN"}
        description={`${grn.kind === "replacement" ? "Replacement GRN" : "Goods Receipt Note"} — ${isDraft ? "Draft" : "Posted"}`}
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

      {/* WHAT A REJECTION RAISED (0780): the Debit Note against the vendor's invoice and the
          Rejection DC the goods go back on — and, on a replacement, the DC it fills. */}
      {paper.debitNote || paper.rejectionDc || paper.replacementDc || paper.replaces ? (
        <Card>
          <CardHeader>
            <CardTitle>Rejection &amp; replacement</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {paper.replaces ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Replaces goods on</dt>
                  <dd className="mt-0.5">
                    <Link href={`/stores/vendor-returns/${paper.replaces.id}`} className="text-primary hover:underline">
                      {paper.replaces.code ?? "Rejection DC"}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {paper.rejectionDc ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Rejection DC</dt>
                  <dd className="mt-0.5">
                    <Link href={`/stores/vendor-returns/${paper.rejectionDc.id}`} className="text-primary hover:underline">
                      {paper.rejectionDc.code ?? "—"}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">({paper.rejectionDc.status})</span>{" "}
                    {/* The challan the goods go back on, with the debit note copy (0780). */}
                    <Link
                      href={`/stores/vendor-returns/${paper.rejectionDc.id}/print`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Print DC
                    </Link>
                  </dd>
                </div>
              ) : null}
              {paper.replacementDc ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Replacement DC</dt>
                  <dd className="mt-0.5">
                    <Link href={`/stores/vendor-returns/${paper.replacementDc.id}`} className="text-primary hover:underline">
                      {paper.replacementDc.code ?? "—"}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">({paper.replacementDc.status})</span>{" "}
                    {/* The challan the goods go back on, no debit note (0781). */}
                    <Link
                      href={`/stores/vendor-returns/${paper.replacementDc.id}/print`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Print DC
                    </Link>
                  </dd>
                </div>
              ) : null}
              {paper.debitNote ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Debit Note</dt>
                  <dd className="mt-0.5">
                    <Link href="/finance/notes" className="text-primary hover:underline">
                      {paper.debitNote.code ?? "—"}
                    </Link>{" "}
                    <span className="tabular-nums">{fmtMoney(paper.debitNote.amount)}</span>{" "}
                    <span className="text-xs text-muted-foreground">({paper.debitNote.status})</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

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
            {/* The vendor's papers (0777); a GRN saved before then kept one Challan / Inv box. */}
            {grn.challan_no && !grn.invoice_no && !grn.dc_no ? (
              <div>
                <dt className="text-xs text-muted-foreground">Challan / Inv No</dt>
                <dd className="mt-0.5">{grn.challan_no}</dd>
              </div>
            ) : (
              <>
                {/* One paper since 2026-10-31 (Invoice OR DC); a GRN from before may hold both. */}
                {grn.invoice_no || !grn.dc_no ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Invoice No</dt>
                    <dd className="mt-0.5">{grn.invoice_no ?? "—"}</dd>
                  </div>
                ) : null}
                {grn.dc_no ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">DC No</dt>
                    <dd className="mt-0.5">{grn.dc_no}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">{grn.dc_no && !grn.invoice_no ? "DC Date" : "Invoice Date"}</dt>
                  <dd className="mt-0.5">{fmtDate(grn.invoice_date)}</dd>
                </div>
              </>
            )}
            {/* Notes left the entry on 2026-10-31; a GRN saved before keeps its note. */}
            {grn.notes ? (
              <div>
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{grn.notes}</dd>
              </div>
            ) : null}
          </dl>
          {grn.over_receipt_authorized_at && (
            <p className="mt-3 text-sm text-warning">
              Over-receipt authorised by {grn.over_receipt_authorized_by_name ?? "a Store Manager"} on{" "}
              {fmtDateTime(grn.over_receipt_authorized_at)}: {grn.over_receipt_reason}
            </p>
          )}
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
          {/* A QUALITY CHECK FAILED THE GOODS, BUT NOTHING IS REJECTED (grn-plan.md Phase 4):
              the check's verdict reaches the line (completeGanCheck), the qty does not — a
              check says the goods failed, not how many. Said here, before Post, rather than
              found later as failed stock sitting in the Material store. */}
          {(() => {
            const failed = lines.filter((l) => l.qc_status === "failed" && !(Number(l.rejected_qty) > 0));
            return isDraft && failed.length > 0 ? (
              <div className="border-b border-border bg-danger/5">
                <p className="px-4 pt-2 text-sm text-danger">
                  Quality check failed on {failed.length === 1 ? "this line" : `${failed.length} lines`} — but nothing
                  is rejected. Enter the rejected qty before posting, or the failed goods go into stock as accepted.
                </p>
                {failed.map((l) => (
                  <LineRejectionFix
                    key={l.id}
                    lineId={l.id}
                    description={l.description}
                    received={Number(l.received_qty) || 0}
                    isReplacement={grn.kind === "replacement"}
                  />
                ))}
              </div>
            ) : null;
          })()}
          <DataTable paginate={false}
            columns={lineColumns}
            rows={lines}
            getKey={(r) => r.id}
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
