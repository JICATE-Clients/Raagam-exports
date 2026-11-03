import { buttonClasses } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/types";
import Link from "next/link";
import { FileText } from "lucide-react";
import { DocBackLink, DocFacts, DocPrintIcon } from "@/components/purchase/doc-facts";
import { HUG } from "@/components/ui/created-columns";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getGrn, getGrnLines, getGrnPaper } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
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

/* FITS WITHOUT A SIDEWAYS SCROLL (user 2026-11-03, screenshot 4000): every short column hugs
   its content (HUG) and Description alone takes the spare width, wrapping a long item name
   instead of pushing Store off the edge. The PO column only appears when the GRN received
   against more than one PO — with one, the strip above already says which. Store and Bin are
   one column, as on the entry screen. */
function lineColumnsFor(multiPo: boolean): Column<GrnLineWithPo>[] {
  return [
    ...(multiPo
      ? [{ header: "PO", className: HUG, cell: (r: GrnLineWithPo) => <span className="text-xs text-muted-foreground">{r.po_code ?? "—"}</span> }]
      : []),
    { header: "Description", className: "w-full", cell: (r) => r.description },
    { header: "Received", align: "right", className: HUG, cell: (r) => <span className="tabular-nums">{fmtNumber(r.received_qty)}</span> },
    { header: "Accepted", align: "right", className: HUG, cell: (r) => <span className="tabular-nums">{fmtNumber(r.accepted_qty)}</span> },
    { header: "Rejected", align: "right", className: HUG, cell: (r) => <span className="tabular-nums">{fmtNumber(r.rejected_qty)}</span> },
    {
      header: "QC",
      className: HUG,
      cell: (r) => <StatusPill tone={statusTone(r.qc_status, TASK_PROGRESS)}>{qcLabel[r.qc_status]}</StatusPill>,
    },
    {
      header: "Rejection",
      className: HUG,
      // With where the rejected qty went (0780): sent again on this PO, or closed and re-bought.
      cell: (r) =>
        r.rejection_reason ? `${r.rejection_reason} · ${r.rejection_action === "return" ? "Rejection" : "Replacement"}` : "—",
    },
    { header: "Lot No", className: HUG, cell: (r) => r.roll_batch_no ?? "—" },
    // Where the accepted goods were put (0777); posting books them there (0779).
    {
      header: "Store · Bin",
      className: HUG,
      cell: (r) => (r.store_name ? `${r.store_name}${r.bin_code ? ` · ${r.bin_code}` : ""}` : "—"),
    },
  ];
}

/** A return DC on the GRN: its number (opens it), its state, and the print as an ICON
 *  (user 2026-11-03: "print DC give as icon") — the report icon the PO list uses. */
function ReturnDcLink({ dc }: { dc: { id: string; code: string | null; status: string } }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/purchase/vendor-returns/${dc.id}`} className="text-primary hover:underline">
        {dc.code ?? "—"}
      </Link>
      <span className="text-xs font-normal text-muted-foreground">({dc.status})</span>
      <Link
        href={`/purchase/vendor-returns/${dc.id}/print`}
        aria-label={`Print DC ${dc.code ?? ""}`}
        title="Print DC"
        className={`${buttonClasses({ variant: "ghost", size: "icon" })} h-7 w-7 text-primary`}
      >
        <FileText aria-hidden className="size-4" />
      </Link>
    </span>
  );
}

export default async function GrnDetailPage({
  params,
}: {
  params: Promise<{ grnId: string }>;
}) {
  const user = await requirePermission("materials_purchase", "view");
  const { grnId } = await params;

  const [grn, lines] = await Promise.all([getGrn(grnId), getGrnLines(grnId)]);
  if (!grn) notFound();
  // The paper a rejection raised, and the DC a replacement fills (0780).
  const paper = await getGrnPaper(grn);

  const isDraft = grn.status === "draft";
  const poCodes = [...new Set(lines.map((l) => l.po_code).filter(Boolean))] as string[];

  return (
    <div className="space-y-4">
      <PageHeader
        title={grn.code ?? "GRN"}
        description={`${grn.kind === "replacement" ? "Replacement GRN" : "Goods Receipt Note"} — ${isDraft ? "Draft" : "Posted"}`}
      />

      {/* ONE STRIP (user 2026-11-03, screenshot 4000: "make it single section … single row,
          compact"). Was two titled cards — "Rejection & replacement" and "GRN Details" — each a
          four-column grid. GRN No first, then the vendor's paper (No → Date), the vendor and
          every PO (user 2026-11-02, screenshot 3952), then what a rejection raised (0780). */}
      <DocFacts
        trailing={
          <>
            <StatusPill tone={isDraft ? "warning" : "success"}>{isDraft ? "Draft" : "Posted"}</StatusPill>
            {/* The GRN slip, with each line's bin breakdown (user 2026-10-31). */}
            <DocPrintIcon href={`/purchase/grn/${grnId}/print`} label="Print GRN" />
            {isDraft && <PostGrnButton grnId={grnId} />}
            {/* EDIT A POSTED GRN (0792): the paper always; quantities while nothing has moved. */}
            {!isDraft && hasPermission(user, "materials_purchase", "edit") ? (
              <Link href={`/purchase/grn/${grnId}/edit`} className={buttonClasses({ size: "md" })}>
                Edit GRN
              </Link>
            ) : null}
            <DocBackLink href="/purchase/grn" />
          </>
        }
        facts={[
          { label: "GRN No", value: grn.code ?? "—", mono: true },
          { label: "GRN Date", value: fmtDate(grn.grn_date) },
          // The vendor's papers (0777); a GRN saved before then kept one Challan / Inv box.
          ...(grn.challan_no && !grn.invoice_no && !grn.dc_no
            ? [{ label: "Challan / Inv No", value: grn.challan_no }]
            : [
                // One paper since 2026-10-31 (Invoice OR DC); a GRN from before may hold both.
                grn.invoice_no || !grn.dc_no ? { label: "Invoice No", value: grn.invoice_no ?? "—" } : null,
                grn.dc_no ? { label: "DC No", value: grn.dc_no } : null,
                { label: grn.dc_no && !grn.invoice_no ? "DC Date" : "Invoice Date", value: fmtDate(grn.invoice_date) },
              ]),
          { label: "Vendor", value: grn.vendors?.name ?? "—" },
          // PLACE OF DELIVERY + VEHICLE (0792).
          {
            label: "Received Store",
            value: (grn as { delivery_kind?: string | null }).delivery_kind === "direct" ? "Direct to processor" : "Our store",
          },
          (grn as { vehicle_ref?: string | null }).vehicle_ref
            ? { label: "Vehicle Ref", value: (grn as { vehicle_ref?: string | null }).vehicle_ref }
            : null,
          { label: "PO No", value: poCodes.join(", ") || "—", mono: true },
          // WHAT A REJECTION RAISED (0780): the DC the goods go back on (with its print icon),
          // the DC a replacement fills, and the Debit Note against the vendor's invoice.
          paper.replaces
            ? {
                label: "Replaces goods on",
                value: (
                  <Link href={`/purchase/vendor-returns/${paper.replaces.id}`} className="text-primary hover:underline">
                    {paper.replaces.code ?? "Rejection DC"}
                  </Link>
                ),
              }
            : null,
          paper.rejectionDc ? { label: "Rejection DC", value: <ReturnDcLink dc={paper.rejectionDc} /> } : null,
          paper.replacementDc ? { label: "Replacement DC", value: <ReturnDcLink dc={paper.replacementDc} /> } : null,
          paper.debitNote
            ? {
                label: "Debit Note",
                value: (
                  <>
                    <Link href="/finance/notes" className="text-primary hover:underline">
                      {paper.debitNote.code ?? "—"}
                    </Link>{" "}
                    <span className="tabular-nums">{fmtMoney(paper.debitNote.amount)}</span>{" "}
                    <span className="text-xs font-normal text-muted-foreground">({paper.debitNote.status})</span>
                  </>
                ),
              }
            : null,
          // Notes left the entry on 2026-10-31; a GRN saved before keeps its note.
          grn.notes ? { label: "Notes", value: <span className="font-normal text-muted-foreground">{grn.notes}</span> } : null,
        ]}
      >
        {grn.over_receipt_authorized_at ? (
          <p className="text-sm text-warning">
            Over-receipt authorised by {grn.over_receipt_authorized_by_name ?? "a Store Manager"} on{" "}
            {fmtDateTime(grn.over_receipt_authorized_at)}: {grn.over_receipt_reason}
          </p>
        ) : null}
      </DocFacts>

      {/* Lines */}
      <div className="space-y-3">
        {/* NO "Lines" CARD (user 2026-11-03: "lines layout remove it from overall module"): the
          table sits on the page, full width — the card only added a second frame and a title. */}
        {isDraft && (
            <span className="text-xs text-warning">
              Draft — post to update PO received quantities
            </span>
          )}
        <div className="p-0">
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
            columns={lineColumnsFor(poCodes.length > 1)}
            dense="spacing"
            rows={lines}
            getKey={(r) => r.id}
          />
        </div>
      </div>

      {isDraft && (
        <p className="text-sm text-muted-foreground">
          Once posted, this GRN is read-only and PO quantities will be updated.
        </p>
      )}
    </div>
  );
}
