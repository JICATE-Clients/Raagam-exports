"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  loadFabricBomEntryRegister,
  loadYarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/actions";
import type {
  BomDocHeader,
  EntryRegister,
  EntryRegisterComponentGroup,
  YarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/reports";
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

/**
 * Row 1 of the Yarn & Fabric Requirement Report's header — Customer / SC No /
 * Order No / Style Ref No / Delivery, ONE LINE (client spec, 2026-09-11).
 * `EntryRegisterFactsRow` below renders the identical five facts for Report
 * 1 — kept as two components, one per report, rather than merged into one
 * shared row: each report's own title sits beside it, and the two are free
 * to diverge again the moment either report's spec does. `QuantityBand`
 * right below IS still shared — its five facts
 * (Order/Excess/Rejection/Approval/SQ Qty) are the client's Row 2 verbatim
 * for BOTH reports, so there was nothing to fork there.
 */
function YarnReportFactsRow({ header }: { header: BomDocHeader }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px]">
      <YarnFact label="Customer" value={header.customer} />
      <YarnFact label="SC No" value={header.scNo} mono />
      <YarnFact label="Order No" value={header.orderNo} mono />
      <YarnFact label="Style Ref No" value={header.styleRefNo} mono />
      <YarnFact label="Delivery" value={fmtDate(header.deliveryFromDate)} mono />
    </div>
  );
}

function YarnFact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <span>
      <span className="text-[#8b95a3]">{label}: </span>
      <span className={mono ? "font-mono" : ""}>{value || "—"}</span>
    </span>
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
        <span className="text-[#8b95a3]">Excess Qty{header.excessPct != null ? ` ${header.excessPct}%` : ""}</span>{" "}
        {fmtNumber(qty.excessQty)}
      </span>
      <span>
        <span className="text-[#8b95a3]">
          Rejection Allowance
          {qty.orderQty > 0 ? ` ${((qty.rejectionQty / qty.orderQty) * 100).toFixed(2)}%` : ""}
        </span>{" "}
        {fmtNumber(qty.rejectionQty)}
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

/**
 * Row 1 of the Entry Register's header — Customer / SC No / Order No / Style
 * Ref No / Delivery, ONE LINE (client spec, 2026-09-11), the same five facts
 * in the same order the reference PDF `FabricBomEntryRegister_*.pdf` prints
 * and `YarnReportFactsRow` above already gives Report 2. Style No / BOM Dt /
 * Computed / SQ No / SQ Description never appear in that printed letterhead
 * either, so this row doesn't carry them on screen — see the note beside
 * `YarnReportFactsRow` for why the two reports each get their own copy of
 * this row rather than a single shared one.
 */
function EntryRegisterFactsRow({ header }: { header: BomDocHeader }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px]">
      <YarnFact label="Customer" value={header.customer} />
      <YarnFact label="SC No" value={header.scNo} mono />
      <YarnFact label="Order No" value={header.orderNo} mono />
      <YarnFact label="Style Ref No" value={header.styleRefNo} mono />
      <YarnFact label="Delivery" value={fmtDate(header.deliveryFromDate)} mono />
    </div>
  );
}

const ENTRY_GRID_DETAILED_COLS = [
  "Assort Colour",
  "Component",
  "Fabric",
  "Item Form",
  "GSM",
  "Size",
  "Dia/Size",
  "Width",
  "SQ Qty",
  "Piece Wt",
  "Wastage %",
  "Net Req Wt",
  "Loss %",
  "Total (Gross) Wt",
  "Unit",
] as const;

const ENTRY_GRID_SUMMARY_COLS = [
  "Assort Colour",
  "Component",
  "Fabric",
  "Item Form",
  "GSM",
  "SQ Qty",
  "Avg Piece Wt",
  "Net Req Wt",
  "Loss %",
  "Total (Gross) Wt",
  "Unit",
] as const;

function EntryRegisterView({ data }: { data: EntryRegister | { refused: string } | null }) {
  const [viewMode, setViewMode] = useState<"detailed" | "summary">("detailed");

  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }

  return (
    <div>
      <ExportBar onCsv={() => exportEntryRegisterCsv(data)} onPdf={() => exportEntryRegisterPdf(data)} />

      <Letterhead title="Fabric BOM Entry Register" docNo={data.header.bomCode} />
      <EntryRegisterFactsRow header={data.header} />
      <QuantityBand header={data.header} />

      {/* DETAILED VS SUMMARY — a floor operator wants every size row, a
          reviewer wants one line per component averaging piece consumption
          weight (client spec, 2026-09-11). Same toggle shape as the Yarn &
          Fabric Requirement tab's Procurement/Production switch below it in
          this file; scoped to local state because nothing here needs to
          persist across a re-open of the Sheet. */}
      <div className="my-3 flex items-center gap-1 rounded-md border border-border bg-white p-1 text-[12.5px] font-medium">
        {(["detailed", "summary"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setViewMode(v)}
            className={`flex-1 rounded px-3 py-1.5 ${viewMode === v ? "bg-[#037bb8] text-white" : "text-[#5b6472] hover:bg-[#f1f3f5]"}`}
          >
            {v === "detailed" ? "Detailed Size View" : "Summary Component View"}
          </button>
        ))}
      </div>

      {/* A FLAT TABLE, COLUMN-FOR-COLUMN WITH THE REFERENCE PDF — Assort
          Colour / Component / Fabric repeat on every row rather than reading
          as section headers, because that is what the legacy printout and
          this app's own PDF/CSV export already render (see
          `lib/orders/fabric-bom/reports-export.ts`'s `registerBody`); a
          nested accordion here would be a second layout for one document. */}
      <ReportTable>
        <thead>
          <tr>
            {(viewMode === "detailed" ? ENTRY_GRID_DETAILED_COLS : ENTRY_GRID_SUMMARY_COLS).map((c) => (
              <Th key={c} right={NUMERIC_ENTRY_COLS.has(c)}>
                {c}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.groups.map((group) => (
            <EntryColourRows key={group.combo ?? "unassigned"} group={group} viewMode={viewMode} />
          ))}
          <tr className="bg-[#eaf7fd] font-semibold text-[#037bb8]">
            <Td className="font-semibold">GRAND TOTAL</Td>
            <Td colSpan={viewMode === "detailed" ? 7 : 4}>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.sqQty)}</Td>
            <Td colSpan={viewMode === "detailed" ? 2 : 1}>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.netReqWt)}</Td>
            <Td>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.grossWt)}</Td>
            <Td>{""}</Td>
          </tr>
        </tbody>
      </ReportTable>

      <div className="mb-6" />

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

const NUMERIC_ENTRY_COLS = new Set([
  "GSM",
  "Dia/Size",
  "Width",
  "SQ Qty",
  "Piece Wt",
  "Avg Piece Wt",
  "Wastage %",
  "Net Req Wt",
  "Loss %",
  "Total (Gross) Wt",
]);

/** One ASSORT COLOUR's rows — every (component, size) row in Detailed mode
 *  or one row per component in Summary mode, a `— subtotal` row per
 *  component (Detailed only — a Summary row already IS the component's
 *  total, so a second row under it would double it up), and a colour-level
 *  `— subtotal` row, matching the reference PDF's own hierarchy verbatim. */
function EntryColourRows({
  group,
  viewMode,
}: {
  group: EntryRegister["groups"][number];
  viewMode: "detailed" | "summary";
}) {
  const label = group.combo || "Unassigned";
  return (
    <>
      {group.components.map((comp) =>
        viewMode === "detailed" ? (
          <EntryComponentDetailedRows key={comp.key} colour={label} comp={comp} />
        ) : (
          <EntryComponentSummaryRow key={comp.key} colour={label} comp={comp} />
        ),
      )}
      <tr className="bg-[#f1f3f5] font-semibold">
        <Td className="font-semibold">{label} — subtotal</Td>
        <Td colSpan={viewMode === "detailed" ? 7 : 4}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.sqQty)}</Td>
        <Td colSpan={viewMode === "detailed" ? 2 : 1}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.netReqWt)}</Td>
        <Td>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.grossWt)}</Td>
        <Td>{""}</Td>
      </tr>
    </>
  );
}

function EntryComponentDetailedRows({ colour, comp }: { colour: string; comp: EntryRegisterComponentGroup }) {
  const componentLabel = comp.componentNames.join(", ") || "—";
  return (
    <>
      {comp.sizes.map((s, i) => (
        <tr key={i} className="odd:bg-white even:bg-[#fafbfc]">
          <Td>{colour}</Td>
          <Td>{componentLabel}</Td>
          <Td>{comp.fabricName}</Td>
          <Td><ItemFormBadge form={comp.itemForm} /></Td>
          <Td right mono>{comp.gsm != null ? fmtNumber(comp.gsm) : "—"}</Td>
          <Td>{s.sizeLabel}</Td>
          <Td right mono>{s.dia != null ? fmtNumber(s.dia) : "—"}</Td>
          <Td right mono>{s.purchaseWidth != null ? fmtNumber(s.purchaseWidth) : "—"}</Td>
          <Td right mono>{fmtNumber(s.sqQty)}</Td>
          <Td right mono>{s.pieceWt != null ? fmtNumber(s.pieceWt) : "—"}</Td>
          <Td right mono>{s.wastagePct != null ? `${s.wastagePct}%` : "—"}</Td>
          <Td right mono>{fmtNumber(s.netReqWt)}</Td>
          <Td right mono>
            <span className="inline-flex items-center">
              {s.lossPct != null ? `${s.lossPct.toFixed(2)}%` : "—"}
              {comp.lossChain.length > 0 && <LossChainInfo chain={comp.lossChain} />}
            </span>
          </Td>
          <Td right mono>{fmtNumber(s.grossWt)}</Td>
          <Td>{s.uomCode ?? "—"}</Td>
        </tr>
      ))}
      <tr className="bg-[#f1f3f5] font-semibold">
        <Td className="font-semibold">{""}</Td>
        <Td className="font-semibold">{componentLabel} — subtotal</Td>
        <Td colSpan={6}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(comp.subtotal.sqQty)}</Td>
        <Td colSpan={2}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(comp.subtotal.netReqWt)}</Td>
        <Td>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(comp.subtotal.grossWt)}</Td>
        <Td>{""}</Td>
      </tr>
    </>
  );
}

/** One component, collapsed to a single row — "component summary rows
 *  showing average piece consumption weight" (client spec, 2026-09-11). Loss
 *  % is not a second stored figure: every size within one component shares
 *  the same backward-markup ladder, so `comp.subtotal`'s own ratio already
 *  IS the component's compounded loss — never re-derived from one size row. */
function EntryComponentSummaryRow({ colour, comp }: { colour: string; comp: EntryRegisterComponentGroup }) {
  const pieceWts = comp.sizes.map((s) => s.pieceWt).filter((w): w is number => w != null);
  const avgPieceWt = pieceWts.length > 0 ? pieceWts.reduce((a, b) => a + b, 0) / pieceWts.length : null;
  const lossPct = comp.subtotal.netReqWt !== 0 ? (comp.subtotal.grossWt / comp.subtotal.netReqWt - 1) * 100 : null;
  const uomCode = comp.sizes.find((s) => s.uomCode)?.uomCode ?? null;
  return (
    <tr className="odd:bg-white even:bg-[#fafbfc]">
      <Td>{colour}</Td>
      <Td>{comp.componentNames.join(", ") || "—"}</Td>
      <Td>{comp.fabricName}</Td>
      <Td><ItemFormBadge form={comp.itemForm} /></Td>
      <Td right mono>{comp.gsm != null ? fmtNumber(comp.gsm) : "—"}</Td>
      <Td right mono>{fmtNumber(comp.subtotal.sqQty)}</Td>
      <Td right mono>{avgPieceWt != null ? fmtNumber(avgPieceWt) : "—"}</Td>
      <Td right mono>{fmtNumber(comp.subtotal.netReqWt)}</Td>
      <Td right mono>
        <span className="inline-flex items-center">
          {lossPct != null ? `${lossPct.toFixed(2)}%` : "—"}
          {comp.lossChain.length > 0 && <LossChainInfo chain={comp.lossChain} />}
        </span>
      </Td>
      <Td right mono>{fmtNumber(comp.subtotal.grossWt)}</Td>
      <Td>{uomCode ?? "—"}</Td>
    </tr>
  );
}

/** Open Width / Tubular pill. This app's own green accent (`#85c227`, already
 *  the Letterhead's left bar) for Tubular rather than an arbitrary green —
 *  Open Width borrows the report's existing blue. Renders nothing for a null
 *  `itemForm`, which is also how a stray badge never appears next to a
 *  fabric whose form was never recorded. */
function ItemFormBadge({ form }: { form: string | null }) {
  if (!form) return null;
  const isOpenWidth = form === "Open Width";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        isOpenWidth ? "bg-[#037bb8]/15 text-[#037bb8]" : "bg-[#85c227]/20 text-[#4f7a17]"
      }`}
    >
      {form}
    </span>
  );
}

/** The Loss % ℹ affordance. Click, not hover — this has to work on touch,
 *  and `Tooltip` above is a hover/press-and-hold LABEL, not a click-toggled
 *  panel with structured content, so this is the "smallest thing that works"
 *  the brief calls for rather than a misuse of that primitive. Portaled to
 *  `document.body` for the same reason `Tooltip` is: `ReportTable` wraps its
 *  `<table>` in `overflow-x-auto`, which would clip a plain absolutely-
 *  positioned panel sitting inside a right-hand column. */
function LossChainInfo({ chain }: { chain: { processName: string; lossPct: number }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen(true);
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Show loss % breakdown by process"
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#037bb8]/15 text-[9px] font-bold leading-none text-[#037bb8]"
      >
        i
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            role="status"
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 400 }}
            onPointerDown={(e) => e.stopPropagation()}
            className="max-w-xs whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#16181d] shadow-md"
          >
            {chain.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="text-[#8b95a3]"> {"→"} </span>}
                {c.processName} ({c.lossPct.toFixed(2)}%)
              </span>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Report 2 — Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------

const STAGE_BADGE_TONE: Record<string, string> = {
  GREY: "bg-[#e4e6ea] text-[#4a5261]",
  RFD: "bg-[#fde8cc] text-[#8a5a15]",
  DYED: "bg-[#dbeafe] text-[#1e5a9c]",
};

/** GREY / RFD / DYED, coloured — so a warehouse or mill supervisor reads the
 *  state at a glance rather than parsing a word in a dense table. Falls back
 *  to a neutral tone for any other stage-state word rather than refusing to
 *  render one this app hasn't seen yet. */
function StageBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STAGE_BADGE_TONE[state] ?? "bg-[#e4e6ea] text-[#4a5261]"}`}
    >
      {state}
    </span>
  );
}

function RequirementReportView({
  data,
}: {
  data: YarnFabricRequirementReport | { refused: string } | null;
}) {
  /* HOOKS ABOVE THE EARLY RETURN BELOW, ALWAYS (AGENTS.md's standing rule —
     this exact file's sibling screen has taken production down five times
     over this). `data` starts null while the fetch is in flight and can
     resolve to a refusal, so every piece of view state this component owns
     has to exist before either of those branches, not after. */
  const [view, setView] = useState<"procurement" | "production">("production");
  const [openYarn, setOpenYarn] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }

  const openYarnLine = data.yarns.find((y) => y.itemId === openYarn) ?? null;
  const toggleStage = (name: string) => {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
  };

  return (
    <div>
      <ExportBar
        onCsv={() => exportYarnRequirementCsv(data)}
        onPdf={() => exportYarnRequirementPdf(data)}
      />

      <Letterhead title="Yarn &amp; Fabric Requirement" docNo={data.header.bomCode} />
      <YarnReportFactsRow header={data.header} />
      <QuantityBand header={data.header} />

      {/* PROCUREMENT VS PRODUCTION — sourcing wants a purchase list, a mill
          supervisor wants the full stage-by-stage ledger; nobody at either
          desk wants to scroll past the other's section to find their own.
          Neither table is destroyed by the toggle — this only hides the one
          not being read, so switching back costs nothing. */}
      <div className="my-3 flex items-center gap-1 rounded-md border border-border bg-white p-1 text-[12.5px] font-medium">
        {(["procurement", "production"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded px-3 py-1.5 ${view === v ? "bg-[#037bb8] text-white" : "text-[#5b6472] hover:bg-[#f1f3f5]"}`}
          >
            {v === "procurement" ? "Procurement View — Yarn Summary" : "Production View — Full Stage Ledger"}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <SectionHeader>Yarn Purchase Requirement</SectionHeader>
        <ReportTable>
          <thead>
            <tr>
              <Th>Stage</Th>
              <Th>Type</Th>
              <Th>Yarn Description</Th>
              <Th>Color</Th>
              <Th right>Plan Wt</Th>
              <Th right>Loss %</Th>
              <Th right>To Ordered Wt</Th>
            </tr>
          </thead>
          <tbody>
            {data.yarns.map((y) => (
              <tr
                key={y.itemId}
                onClick={() => y.byFabric.length > 0 && setOpenYarn(y.itemId)}
                className={`odd:bg-white even:bg-[#fafbfc] ${y.byFabric.length > 0 ? "cursor-pointer hover:bg-[#eaf7fd]" : ""}`}
                title={y.byFabric.length > 0 ? "Click to see which fabrics contributed to this total" : undefined}
              >
                <Td><StageBadge state={y.stageState} /></Td>
                <Td>{y.itemType}</Td>
                <Td>
                  {y.yarnName}
                  {y.byFabric.length > 0 && <span className="ml-1 text-[#037bb8]">▸</span>}
                </Td>
                <Td>{y.color ?? "—"}</Td>
                <Td right mono>{y.purchaseQty != null ? fmtNumber(y.purchaseQty) : "—"}</Td>
                <Td right mono>—</Td>
                <Td right mono className={y.refusalReason ? "text-destructive" : ""}>
                  {y.purchaseQty != null ? fmtNumber(y.purchaseQty) : (y.refusalReason ?? "—")}
                </Td>
              </tr>
            ))}
            {data.yarnGrandTotal && (
              <tr className="bg-[#eaf7fd] font-semibold text-[#037bb8]">
                <Td colSpan={4}>Total Yarn Purchase Requirement</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnGrandTotal.qty)}</Td>
                <Td>{""}</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnGrandTotal.qty)}</Td>
              </tr>
            )}
          </tbody>
        </ReportTable>
      </div>

      {/* THE DRILL-DOWN DRAWER — which fabrics fed one aggregated yarn row.
          A plain inline panel rather than a portal: it is scoped to ONE row
          of the table above it, so it reads as that row's own expansion,
          not a second surface competing with the Sheet it lives inside. */}
      {openYarnLine && (
        <div className="mb-6 rounded-md border border-[#037bb8]/30 bg-[#eaf7fd] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12.5px] font-bold text-[#037bb8]">
              {openYarnLine.yarnName} — by fabric
            </div>
            <button
              type="button"
              onClick={() => setOpenYarn(null)}
              className="text-[11px] font-medium text-[#5b6472] hover:text-foreground"
            >
              Close ✕
            </button>
          </div>
          <ReportTable>
            <thead>
              <tr>
                <Th>Fabric</Th>
                <Th>Colour</Th>
                <Th right>Contribution</Th>
              </tr>
            </thead>
            <tbody>
              {openYarnLine.byFabric.map((c, i) => (
                <tr key={i} className="odd:bg-white even:bg-[#fafbfc]">
                  <Td>{c.fabricName}</Td>
                  <Td>{c.combo ?? "—"}</Td>
                  <Td right mono>{fmtNumber(c.wt)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      )}

      {view === "production" && (
        <div>
          <SectionHeader>Process Stage Ledger</SectionHeader>
          {data.stageBreakdown.map((g, gi) => {
            const isOpen = !collapsed.has(g.processName);
            return (
              <div key={g.processName}>
                <button
                  type="button"
                  onClick={() => toggleStage(g.processName)}
                  className={`flex w-full items-center justify-between border-x border-border bg-[#f6f7f9] px-4 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#5b6472] hover:bg-[#eef0f2] ${gi === 0 ? "" : "border-t"}`}
                >
                  <span>{g.processName}</span>
                  <span className="font-mono text-[10px] normal-case tracking-normal text-[#8b95a3]">
                    {fmtNumber(g.toOrderedTotal)} · {isOpen ? "▾ collapse" : "▸ expand"}
                  </span>
                </button>
                {isOpen && (
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
