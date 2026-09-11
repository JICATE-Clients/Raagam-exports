"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  loadFabricBomEntryRegister,
  loadYarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/actions";
import type { BomDocHeader, EntryRegister, YarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import {
  exportEntryRegisterCsv,
  exportEntryRegisterPdf,
  exportYarnRequirementCsv,
  exportYarnRequirementPdf,
} from "@/lib/orders/fabric-bom/reports-export";

/**
 * Orders ▸ Fabric BOM ▸ Reports — a `size="lg"` Sheet holding both per-BOM
 * documents (see `lib/orders/fabric-bom/reports.ts`'s header for what each
 * reads). `lg`, not `sm`: this is a dense multi-section document register,
 * not the small nested-picker popup the sub-detail-sheet-size convention is
 * about — see the `raagam-screen-layout` skill's own distinction.
 *
 * THE LOOK BORROWS `FabricRequirementSheetDocument`'s LANGUAGE (letterhead
 * band, tinted section headers, bordered table) deliberately, not by
 * accident — a reader who knows one Fabric BOM document should recognise the
 * other, and a floor operator comparing this against the legacy RP-Software
 * printout should see the same kind of page, not a plain HTML table.
 *
 * READ-ONLY: no fields, no Save, no `useUnsavedGuard` — nothing here can be
 * left half-typed. `footer` names how it closes and nothing else, the same
 * `SubSheetFooter` shape a sub-detail with nothing of its own to save already
 * uses elsewhere in this module.
 */
export function FabricBomReportsSheet({
  bomId,
  open,
  onClose,
}: {
  bomId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  /* KEYED BY THE BOM IT WAS LOADED FOR, never reset synchronously — the same
     `paletteState.forOrder` idiom this screen already uses. `set-state-in-
     effect` (React Compiler) is an ERROR here: a `setLoading(true)` / reset
     pair at the top of the effect body is exactly the shape it refuses, and
     AGENTS.md already records the fix for this file's siblings — derive
     "loading" and "stale for a different BOM" at render time instead of
     stamping them from the effect. */
  const [register, setRegister] = useState<{
    forBom: string;
    data: EntryRegister | { refused: string };
  } | null>(null);
  const [requirement, setRequirement] = useState<{
    forBom: string;
    data: YarnFabricRequirementReport | { refused: string };
  } | null>(null);

  useEffect(() => {
    if (!open || !bomId) return;
    let cancelled = false;
    Promise.all([loadFabricBomEntryRegister(bomId), loadYarnFabricRequirementReport(bomId)]).then(
      ([r, y]) => {
        if (cancelled) return;
        setRegister({ forBom: bomId, data: r });
        setRequirement({ forBom: bomId, data: y });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, bomId]);

  const registerData = register && bomId && register.forBom === bomId ? register.data : null;
  const requirementData =
    requirement && bomId && requirement.forBom === bomId ? requirement.data : null;
  const loading = open && !!bomId && registerData == null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="Fabric BOM Reports"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {loading || !bomId ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="bg-[#f1f3f5] p-4">
          <Tabs
            items={[
              {
                key: "register",
                label: "Fabric BOM Entry Register",
                content: <EntryRegisterView data={registerData} />,
              },
              {
                key: "requirement",
                label: "Yarn & Fabric Requirement",
                content: <RequirementReportView data={requirementData} />,
              },
            ]}
          />
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Shared document chrome — the letterhead, the identity strip, the quantity
// band. One component for both reports, so the two can never drift apart.
// ---------------------------------------------------------------------------

function Letterhead({ title, docNo }: { title: string; docNo: string | null }) {
  return (
    <div className="grid grid-cols-[6px_1fr] overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
      <div className="bg-[#85c227]" />
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3.5">
        <div className="text-[17px] font-bold tracking-wide text-[#16181d]">RAAGAM EXPORTS</div>
        <div className="text-right">
          <div className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">
            {title}
          </div>
          {docNo && <div className="font-mono text-[12px] text-[#5b6472]">{docNo}</div>}
        </div>
      </div>
    </div>
  );
}

function IdentityStrip({ header }: { header: BomDocHeader }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border border-t-0 border-border bg-white">
      <Fact label="SC No" value={header.scNo} mono />
      <Fact label="Order No" value={header.orderNo} mono />
      <Fact label="Style Ref No" value={header.styleRefNo} mono />
      <Fact label="Style No" value={header.styleNo} />
      <Fact label="Customer" value={header.customer} />
      <Fact label="Delivery" value={fmtDate(header.deliveryFromDate)} mono />
      <Fact label="BOM Dt" value={fmtDate(header.bomDate)} mono />
      <Fact label="Computed" value={header.computedAt ? fmtDateTime(header.computedAt) : "—"} mono />
    </dl>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="border-b border-r border-border px-3 py-2 last:border-r-0">
      <dt className="text-[10px] uppercase tracking-wide text-[#8b95a3]">{label}</dt>
      <dd className={`truncate text-[12.5px] text-[#16181d] ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function QuantityBand({ header }: { header: BomDocHeader }) {
  const qty = header.qty;
  if (isReportRefusal(qty)) {
    return (
      <div className="border border-t-0 border-border bg-[#fdf1f1] px-5 py-2.5 text-[12.5px] font-medium text-destructive">
        {qty.refused}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-t-0 border-border bg-[#f1f3f5] px-5 py-2.5 font-mono text-[12.5px]">
      <span>
        <span className="text-[#8b95a3]">Order Qty</span> {fmtNumber(qty.orderQty)}
      </span>
      <span>
        <span className="text-[#8b95a3]">Excess{header.excessPct != null ? ` ${header.excessPct}%` : ""}</span>{" "}
        {fmtNumber(qty.excessQty)}
      </span>
      <span>
        <span className="text-[#8b95a3]">Rejection Allowance</span> {fmtNumber(qty.rejectionQty)}
      </span>
      <span>
        <span className="text-[#8b95a3]">Approval Allowance</span> {fmtNumber(qty.approvalQty)}
      </span>
      <span className="ml-auto font-semibold text-[#037bb8]">
        SQ Qty {fmtNumber(qty.sqQty)}
      </span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-x border-t border-border bg-[#eaf7fd] px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[.1em] text-[#037bb8]">
      {children}
    </div>
  );
}

/** The bordered table shell every section uses — one border language, so a
 *  table never reads as a different document from the letterhead above it. */
function ReportTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border-x border-b border-border bg-white">
      <table className="w-full min-w-max border-collapse text-[12px]">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-border bg-[#f6f7f9] px-3 py-1.5 font-semibold text-[#5b6472] ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  mono,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-border/60 px-3 py-1.5 ${right ? "text-right" : "text-left"} ${mono ? "font-mono" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

function ExportBar({ onCsv, onPdf }: { onCsv: () => void; onPdf: () => void }) {
  return (
    <div className="mb-3 flex justify-end gap-2 print:hidden">
      <Button type="button" variant="outline" size="md" onClick={onCsv}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button type="button" variant="primary" size="md" onClick={onPdf}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report 1 — Fabric BOM Entry Register
// ---------------------------------------------------------------------------

function EntryRegisterView({ data }: { data: EntryRegister | { refused: string } | null }) {
  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }
  return (
    <div>
      <ExportBar onCsv={() => exportEntryRegisterCsv(data)} onPdf={() => exportEntryRegisterPdf(data)} />

      <Letterhead title="Fabric BOM Entry Register" docNo={data.header.bomCode} />
      <IdentityStrip header={data.header} />
      <QuantityBand header={data.header} />

      <div className="mb-6">
        {data.groups.map((g) => (
          <div key={g.itemId}>
            <SectionHeader>{g.fabricName}</SectionHeader>
            <ReportTable>
              <thead>
                <tr>
                  <Th>Assort Colour</Th>
                  <Th>Component</Th>
                  <Th>Size</Th>
                  <Th right>SQ Qty</Th>
                  <Th right>Piece Wt</Th>
                  <Th right>Wastage %</Th>
                  <Th right>Net Req Wt</Th>
                  <Th right>Total Wt</Th>
                  <Th>Unit</Th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={i} className="odd:bg-white even:bg-[#fafbfc]">
                    <Td>{l.combo || "—"}</Td>
                    <Td>{l.components.join(", ") || "—"}</Td>
                    <Td>{l.sizeLabel}</Td>
                    <Td right mono>{fmtNumber(l.sqQty)}</Td>
                    <Td right mono>{l.pieceWt != null ? fmtNumber(l.pieceWt) : "—"}</Td>
                    <Td right mono>{l.wastagePct != null ? `${l.wastagePct}%` : "—"}</Td>
                    <Td right mono>{fmtNumber(l.netReqWt)}</Td>
                    <Td right mono>{fmtNumber(l.grossWt)}</Td>
                    <Td>{l.uomCode ?? "—"}</Td>
                  </tr>
                ))}
                <tr className="bg-[#f1f3f5] font-semibold">
                  <Td className="font-semibold" colSpan={3}>
                    Subtotal
                  </Td>
                  <Td right mono className="font-semibold">
                    {fmtNumber(g.subtotal.sqQty)}
                  </Td>
                  <Td colSpan={2}>{""}</Td>
                  <Td right mono className="font-semibold">
                    {fmtNumber(g.subtotal.netReqWt)}
                  </Td>
                  <Td right mono className="font-semibold">
                    {fmtNumber(g.subtotal.grossWt)}
                  </Td>
                  <Td>{""}</Td>
                </tr>
              </tbody>
            </ReportTable>
          </div>
        ))}
        <div className="flex justify-end gap-6 border-x border-b border-border bg-[#eaf7fd] px-4 py-2 text-[12.5px] font-semibold text-[#037bb8]">
          <span>Grand Total</span>
          <span className="font-mono">SQ {fmtNumber(data.grandTotal.sqQty)}</span>
          <span className="font-mono">Wt {fmtNumber(data.grandTotal.grossWt)}</span>
        </div>
      </div>

      <SectionHeader>Process Sequence &amp; Stage Loss Ledger</SectionHeader>
      <ReportTable>
        <thead>
          <tr>
            <Th>Class</Th>
            <Th>Item</Th>
            <Th>Stage</Th>
            <Th>Process</Th>
            <Th right>Loss %</Th>
          </tr>
        </thead>
        <tbody>
          {data.stageLedger.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-[#fafbfc]">
              <Td>{r.className}</Td>
              <Td>{r.itemName}</Td>
              <Td>{r.stageName ?? "—"}</Td>
              <Td>{r.processName ?? "—"}</Td>
              <Td right mono>{r.lossPct != null ? `${r.lossPct.toFixed(2)}%` : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report 2 — Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------

function RequirementReportView({
  data,
}: {
  data: YarnFabricRequirementReport | { refused: string } | null;
}) {
  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }
  return (
    <div>
      <ExportBar
        onCsv={() => exportYarnRequirementCsv(data)}
        onPdf={() => exportYarnRequirementPdf(data)}
      />

      <Letterhead title="Yarn &amp; Fabric Requirement" docNo={data.header.bomCode} />
      <IdentityStrip header={data.header} />
      <QuantityBand header={data.header} />

      <div className="mb-6">
        <SectionHeader>Yarn Purchase Requirement</SectionHeader>
        <ReportTable>
          <thead>
            <tr>
              <Th>Yarn</Th>
              <Th right>Purchase Wt</Th>
              <Th>Unit</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {data.yarns.map((y) => (
              <tr key={y.itemId} className="odd:bg-white even:bg-[#fafbfc]">
                <Td>{y.yarnName}</Td>
                <Td right mono>{y.purchaseQty != null ? fmtNumber(y.purchaseQty) : "—"}</Td>
                <Td>{y.uomCode ?? "—"}</Td>
                <Td className="text-destructive">{y.refusalReason ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      </div>

      <div>
        <SectionHeader>Process Stage Ledger</SectionHeader>
        {data.stageBreakdown.map((g, gi) => (
          <div key={g.processName}>
            <div
              className={`border-x border-border bg-[#f6f7f9] px-4 py-1 text-[11px] font-bold uppercase tracking-wide text-[#5b6472] ${gi === 0 ? "" : "border-t"}`}
            >
              {g.processName}
            </div>
            <ReportTable>
              <thead>
                <tr>
                  <Th>Details</Th>
                  <Th>Colour</Th>
                  <Th right>Planned Wt</Th>
                  <Th right>Loss %</Th>
                  <Th right>To Ordered Wt</Th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={i} className="odd:bg-white even:bg-[#fafbfc]">
                    <Td>{l.fabricName}</Td>
                    <Td>{l.combo ?? "—"}</Td>
                    <Td right mono>{fmtNumber(l.plannedWt)}</Td>
                    <Td right mono>{l.lossPct.toFixed(2)}%</Td>
                    <Td right mono>{fmtNumber(l.toOrderedWt)}</Td>
                  </tr>
                ))}
                <tr className="bg-[#f1f3f5] font-semibold">
                  <Td colSpan={2}>Grand Total</Td>
                  <Td right mono className="font-semibold">{fmtNumber(g.plannedTotal)}</Td>
                  <Td>{""}</Td>
                  <Td right mono className="font-semibold">{fmtNumber(g.toOrderedTotal)}</Td>
                </tr>
              </tbody>
            </ReportTable>
          </div>
        ))}
      </div>
    </div>
  );
}
