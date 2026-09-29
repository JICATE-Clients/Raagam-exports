"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Printer } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { CadPendingBadge } from "@/components/orders/cad/cad-pending-badge";
import { ReportThumbnail } from "@/components/orders/report-thumbnail";
import type { ReportStyleImage } from "@/lib/orders/gos/style-images";
import type { FabricBomReportsSheetLoad } from "@/lib/orders/fabric-bom/reports-sheet";
import { VFinalSheetNote, type SheetVFinal } from "@/components/orders/v-final-sheet-note";
import type {
  BomDocHeader,
  EntryRegister,
  EntryRegisterComponentGroup,
  StageBreakdownLine,
  YarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/reports";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import { sectionAverageLoss } from "@/lib/orders/fabric-bom/color-loss";

/** "Avg 4.34%" for a total row whose lines carry different losses — the PDF's
 *  `avgLossText`, one figure on both renderers. */
function avgLoss(
  lines: readonly { lossPct: number | null | undefined }[],
  planned: number,
  ordered: number,
): string {
  const avg = sectionAverageLoss(lines, planned, ordered);
  return avg == null ? "" : `Avg ${avg.toFixed(2)}%`;
}
/* THE STAGE COLOURS (client 2026-09-20) — one palette with the PDF. */
import {
  COLOURWAY_BAND,
  STAGE_STRIPE,
  STAGE_STYLES,
  sectionStyle,
} from "@/lib/orders/fabric-bom/report-colours";
import {
  ORDER_REPORTS,
  isFabricBomSheetReport,
  type FabricBomReportKey,
} from "@/lib/orders/order-reports";
import {
  exportEntryRegisterPdf,
  exportPrintRequirementPdf,
  exportYarnRequirementPdf,
  sizeRunContinues,
  type PdfOutput,
} from "@/lib/orders/fabric-bom/reports-export";
/* THE SHARED REPORT LOOK (2026-09-29) — moved out of this file so every order
   report draws with it; see ./report-kit.tsx. */
import {
  ReportTable,
  SectionBar,
  SectionHeader,
  StageBadge,
  stripeRow,
  totalRowStyle,
  StageKey,
  Swatch,
  Td,
  Th,
} from "@/components/orders/report-kit";

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

  /* V_FINAL (0619, spec §4B): while the order is amending, these reports are
     the APPROVED version frozen at raise; the merchandiser may switch to the
     proposed figures, and the note says which one is on screen. */
  const [vf, setVf] = useState<{ forBom: string; data: SheetVFinal } | null>(null);
  const [showProposed, setShowProposed] = useState(false);
  /* THE HEADER THUMBNAIL (2026-09-26) — keyed by BOM like the reports. A
     failure resolves to no picture, never an error. */
  const [thumb, setThumb] = useState<{ forBom: string; data: ReportStyleImage | null } | null>(null);

  /* ONE GET REQUEST FOR EVERYTHING ABOVE (2026-09-29, "report opening takes 2
     seconds"). This was four server actions, and server actions are QUEUED: the
     `Promise.all` here ran them one after another, with the thumbnail a fifth
     trip after that. A route handler is not queued, and the server builds the
     Entry Register once for both reports — `lib/orders/fabric-bom/reports-sheet.ts`.
     A failure used to leave "Loading…" up for good; it now prints as the
     reports' refusal, which the view already knows how to show. */
  useEffect(() => {
    if (!open || !bomId) return;
    let cancelled = false;
    fetch(`/api/fabric-bom/${bomId}/reports`, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as FabricBomReportsSheetLoad | null;
        return body ?? { ok: false as const, error: `the server answered ${res.status}` };
      })
      .catch((e: unknown): FabricBomReportsSheetLoad => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }))
      .then((load) => {
        if (cancelled) return;
        if (!load.ok) {
          const refused = { refused: `The reports could not load: ${load.error}` };
          setRegister({ forBom: bomId, data: refused });
          setRequirement({ forBom: bomId, data: refused });
          setVf({ forBom: bomId, data: { state: "live" } });
          setThumb({ forBom: bomId, data: null });
          return;
        }
        setRegister({ forBom: bomId, data: load.register });
        setRequirement({ forBom: bomId, data: load.requirement });
        setVf({ forBom: bomId, data: load.vFinal as SheetVFinal });
        setThumb({ forBom: bomId, data: load.thumbnail });
      });
    return () => {
      cancelled = true;
    };
  }, [open, bomId]);

  const vFinal = vf && bomId && vf.forBom === bomId ? vf.data : null;
  const frozen =
    vFinal && vFinal.state === "frozen" && !showProposed && !("refused" in (vFinal.payload as object))
      ? (vFinal.payload as { register: EntryRegister | { refused: string }; requirement: YarnFabricRequirementReport | { refused: string } })
      : null;
  const registerData = frozen
    ? frozen.register
    : register && bomId && register.forBom === bomId
      ? register.data
      : null;
  const requirementData = frozen
    ? frozen.requirement
    : requirement && bomId && requirement.forBom === bomId
      ? requirement.data
      : null;
  const loading = open && !!bomId && registerData == null;
  const liveRegister = register && bomId && register.forBom === bomId ? register.data : null;
  const thumbnail = thumb && bomId && thumb.forBom === bomId ? thumb.data : null;
  const liveCadPending =
    liveRegister && !("refused" in liveRegister) ? liveRegister.header.cadPending : undefined;

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
          {vFinal && <VFinalSheetNote vf={vFinal} proposed={showProposed} onToggle={() => setShowProposed((v) => !v)} />}
          {/* THE TABS ARE THE REGISTRY'S (client 2026-09-19) — every
              `fabric-bom` entry in `ORDER_REPORTS` with no page of its own, in
              registry order. A tab added here by hand would be a report the
              order's Reports strip never learns about, which is exactly how
              these three went unlinked. */}
          <Tabs
            items={ORDER_REPORTS.filter(isFabricBomSheetReport).map((r) => ({
              key: r.key,
              label: r.label,
              content: (
                <FabricBomReportView
                  report={r.key}
                  register={registerData}
                  requirement={requirementData}
                  /* A FROZEN copy takes the CAD flag from the LIVE register
                     loaded beside it (0628) — the stamp follows today's CAD. */
                  cadPending={frozen ? liveCadPending : undefined}
                  thumbnail={thumbnail}
                />
              ),
            }))}
          />
        </div>
      )}
    </Sheet>
  );
}

/**
 * ONE FABRIC BOM REPORT, BY REGISTRY KEY — the body both the editor's sheet and
 * `/orders/<id>/reports/<key>` render, so the two can never show different
 * documents under one name.
 *
 * A `Record` over `FabricBomReportKey` rather than a switch with a default: a
 * key added to `ORDER_REPORTS` without a view here is a TYPE ERROR, not a tab
 * that renders nothing. Printing Requirement reads the SAME object as Yarn &
 * Fabric Requirement, which is why it takes `requirement`, not data of its own.
 */
type FabricBomReportData = {
  register: EntryRegister | { refused: string } | null;
  requirement: YarnFabricRequirementReport | { refused: string } | null;
  /**
   * The style picture for the header's top-left (2026-09-26) — loaded BESIDE
   * the report, never inside it: a signed URL lives an hour and the report may
   * be a frozen V_final copy (`pickReportThumbnail`). Null/absent → no picture
   * column at all.
   */
  thumbnail?: ReportStyleImage | null;
};

/**
 * THE LIVE CAD FLAG OVER A (POSSIBLY FROZEN) REPORT (0628). A V_final copy
 * carries the flag as it stood at the freeze; the host passes the CURRENT
 * answer and it replaces the stored one, so an approval recorded after the
 * freeze lifts the stamp. `undefined` = keep what the report carries.
 */
function withCadFlag<T extends { header: BomDocHeader } | { refused: string } | null>(
  d: T,
  cadPending: boolean | undefined,
): T {
  if (cadPending === undefined || !d || "refused" in d) return d;
  return { ...d, header: { ...d.header, cadPending } };
}

const FABRIC_BOM_REPORT_VIEWS: Record<FabricBomReportKey, (d: FabricBomReportData) => React.ReactNode> = {
  "fabric-bom-register": (d) => <EntryRegisterView data={d.register} thumbnail={d.thumbnail ?? null} />,
  "yarn-fabric-requirement": (d) => <RequirementReportView data={d.requirement} thumbnail={d.thumbnail ?? null} />,
  "printing-requirement": (d) => <PrintRequirementView data={d.requirement} thumbnail={d.thumbnail ?? null} />,
};

export function FabricBomReportView({
  report,
  cadPending,
  ...data
}: FabricBomReportData & {
  report: FabricBomReportKey;
  /** The CURRENT CAD answer, laid over a frozen copy — see `withCadFlag`. */
  cadPending?: boolean;
}) {
  return (
    <>
      {FABRIC_BOM_REPORT_VIEWS[report]({
        register: withCadFlag(data.register, cadPending),
        requirement: withCadFlag(data.requirement, cadPending),
        thumbnail: data.thumbnail,
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared document chrome — the letterhead, the identity strip, the quantity
// band. One component for both reports, so the two can never drift apart.
// ---------------------------------------------------------------------------

/**
 * THE LETTERHEAD (redesigned 2026-09-19, client: "with logo and more
 * professional look"). The company's logo on the left — the Company Profile's,
 * or the Raagam wordmark placeholder until one is stored (`letterheadLogoOf`) —
 * with the company's name, address and GSTIN beside it; the document's title
 * and number on the right. A thin brand-green rule across the top and a dark
 * rule beneath, the same frame the PDF downloads draw, so the page and the
 * printout read as one document.
 *
 * WHITE GROUND, BRAND ON THE RULES ONLY — the client has refused every tinted
 * surface put in front of them (brand-colours memory); the colour lives on the
 * lines and the title, never on a background.
 */
function Letterhead({ title, header, stageStripe }: { title: string; header: BomDocHeader; stageStripe?: boolean }) {
  const c = header.company;
  /* THE UNIT AND THE REGISTERED ADDRESS (client spec 2026-09-19) — the same
     facts, in the same order, as the PDF letterhead beside this screen. */
  const contact = [c.unit?.toUpperCase(), c.address, c.gstin ? `GSTIN ${c.gstin}` : null]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
      {/* A requirement document wears the four-stage stripe (2026-09-20); the
          Entry Register keeps the brand-green rule. */}
      {stageStripe ? (
        <div className="flex h-[4px]">
          {STAGE_STRIPE.map((c) => (
            <div key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
      ) : (
        <div className="h-[3px] bg-[#85c227]" />
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3">
        <div className="flex min-w-0 items-center gap-4">
          {c.logo && (
            /* A plain <img>: the source may be a stored data URL or an external
               Company Profile URL, which next/image would need configuring
               for; the letterhead is one small, fixed-size image. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo} alt={c.name ?? "Company logo"} className="h-12 w-auto shrink-0 object-contain" />
          )}
          <div className="min-w-0">
            <div className="text-[16px] font-bold uppercase tracking-wide text-[#16181d]">
              {c.name ?? "RAAGAM EXPORTS"}
            </div>
            {contact && <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{contact}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">{title}</div>
          {header.bomCode && <div className="font-mono text-[12px] text-[#5b6472]">{header.bomCode}</div>}
        </div>
      </div>
      {/* CAD PENDING (0628) — under the letterhead of every Fabric BOM report
          while the order's CAD is unapproved; the PDF stamps every page. */}
      {header.cadPending && (
        <div className="border-b border-border px-5 py-2">
          <CadPendingBadge />
        </div>
      )}
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
 * (Order/Excess/Rejection/Approval/Cut Qty) are the client's Row 2 for BOTH
 * reports; the Entry Register passes `excessAsPct` to state Excess % instead
 * of Excess Qty (client 2026-09-23).
 */
function YarnReportFactsRow({ header, thumbnail }: { header: BomDocHeader; thumbnail: ReportStyleImage | null }) {
  return (
    <FactsBlock thumbnail={thumbnail}>
      <YarnFact label="Customer" value={header.customer} />
      <YarnFact label="RE No" value={header.scNo} mono />
      <YarnFact label="Order No" value={header.orderNo} mono />
      <YarnFact label="Style Ref No" value={header.styleRefNo} mono />
      {/* THE `Style` COLUMN beside `Style Ref No`, legacy's own pairing —
          blank on a BOM whose lines cover styles that do not agree, the same
          abstain the ref itself makes. */}
      <YarnFact label="Style" value={header.styleName} />
      <YarnFact label="Delivery" value={fmtDate(header.deliveryFromDate)} mono />
    </FactsBlock>
  );
}

/**
 * THE FACTS ROW'S FRAME — with the style picture at its top-left when one was
 * ticked "Print on reports" (2026-09-26), the facts beside it unchanged. No
 * picture → no left column at all, the facts take the full width.
 */
function FactsBlock({ thumbnail, children }: { thumbnail: ReportStyleImage | null; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px]">
      {thumbnail && <ReportThumbnail image={thumbnail} />}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-1">{children}</div>
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

function QuantityBand({
  header,
  excessAsPct,
}: {
  header: BomDocHeader;
  /** The Entry Register's header states the order's Excess % in place of the
   *  Excess Qty (client 2026-09-23). The requirement reports keep the qty. */
  excessAsPct?: boolean;
}) {
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
      {excessAsPct ? (
        <span>
          <span className="text-[#8b95a3]">Excess %</span>{" "}
          {header.excessPct != null ? `${fmtNumber(header.excessPct)}%` : "—"}
        </span>
      ) : (
        <span>
          <span className="text-[#8b95a3]">Excess Qty{header.excessPct != null ? ` ${header.excessPct}%` : ""}</span>{" "}
          {fmtNumber(qty.excessQty)}
        </span>
      )}
      {/* THE PERCENTAGES ARE THE REPORT'S OWN (`approvalPct` / `rejectionPct`,
          derived in lib/orders/fabric-bom/reports.ts). This band used to
          divide them here while the PDF printed none at all — two renderings
          of one figure, which is what the derived fields exist to stop. */}
      <span>
        <span className="text-[#8b95a3]">
          Rejection Allowance{qty.rejectionPct != null ? ` ${qty.rejectionPct.toFixed(2)}%` : ""}
        </span>{" "}
        {fmtNumber(qty.rejectionQty)}
      </span>
      <span>
        <span className="text-[#8b95a3]">
          Approval Allowance{qty.approvalPct != null ? ` ${qty.approvalPct.toFixed(2)}%` : ""}
        </span>{" "}
        {fmtNumber(qty.approvalQty)}
      </span>
      <span className="ml-auto font-semibold text-[#037bb8]">
        Cut Qty {fmtNumber(qty.cutQty)}
      </span>
    </div>
  );
}

/**
 * PRINT AND PDF, AND NO EXCEL (client spec 2026-09-19) — a requirement report
 * leaves the app only as the document as issued; a spreadsheet can be edited
 * and circulated with our figures changed. Both buttons produce the SAME PDF:
 * Print opens it in a new tab with the print dialog up, so what is printed is
 * what is downloaded, not a browser print of this screen.
 */
function ExportBar({ pdf }: { pdf: (output: PdfOutput) => Promise<void> }) {
  return (
    <div className="mb-3 flex justify-end gap-2 print:hidden">
      {/* Download PDF, then Print / Print Preview — the order and wording of
          the requirement-report ticket (2026-09-20). "Print Preview" is
          accurate: Print opens the same PDF in the browser's print dialog. */}
      <Button type="button" variant="primary" size="md" onClick={() => void pdf("download")}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
      <Button type="button" variant="outline" size="md" onClick={() => void pdf("print")}>
        <Printer className="h-4 w-4" />
        Print / Print Preview
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report 1 — Fabric BOM Entry Register
// ---------------------------------------------------------------------------

/**
 * Row 1 of the Entry Register's header — Customer / RE No / Order No / Style
 * Ref No / Delivery Date, ONE LINE; `QuantityBand excessAsPct` below it is
 * Row 2 — Order Qty / Excess % / Rejection Allowance / Approval Allowance /
 * Cut Qty (client 2026-09-23). The PDF letterhead prints the same ten facts in
 * the same order (`entryRegisterFacts` in reports-export.ts). See the note
 * beside `YarnReportFactsRow` for why the two reports each get their own copy
 * of this row rather than a single shared one.
 */
function EntryRegisterFactsRow({ header, thumbnail }: { header: BomDocHeader; thumbnail: ReportStyleImage | null }) {
  return (
    <FactsBlock thumbnail={thumbnail}>
      <YarnFact label="Customer" value={header.customer} />
      <YarnFact label="RE No" value={header.scNo} mono />
      <YarnFact label="Order No" value={header.orderNo} mono />
      <YarnFact label="Style Ref No" value={header.styleRefNo} mono />
      <YarnFact label="Delivery Date" value={fmtDate(header.deliveryFromDate)} mono />
    </FactsBlock>
  );
}

/** Fixed pixel widths, not `min-w-max` guesses — the whole point of this
 *  table being `table-fixed` (see `ReportTable`). Every width was chosen to
 *  fit BOTH modes' full column set inside a `size="lg"` Sheet without a
 *  horizontal scrollbar on an ordinary desktop viewport; only Fabric is wide
 *  enough to need `Truncated` inside it. */
const ENTRY_GRID_DETAILED_COLS = [
  { label: "Assort Colour", width: 100 },
  { label: "Component", width: 100 },
  { label: "Fabric", width: 260 },
  { label: "Item Form", width: 90 },
  { label: "GSM", width: 55 },
  { label: "Size", width: 110 },
  { label: "Dia/Size", width: 65 },
  { label: "Width", width: 60 },
  { label: "Cut Qty", width: 60 },
  { label: "Piece Wt", width: 65 },
  { label: "Wastage %", width: 70 },
  { label: "Net Req Wt", width: 75 },
  { label: "Loss %", width: 75 },
  { label: "Total (Gross) Wt", width: 85 },
  { label: "Unit", width: 55 },
] as const;

const ENTRY_GRID_SUMMARY_COLS = [
  { label: "Assort Colour", width: 100 },
  { label: "Component", width: 100 },
  { label: "Fabric", width: 260 },
  { label: "Item Form", width: 90 },
  { label: "GSM", width: 55 },
  { label: "Cut Qty", width: 70 },
  { label: "Avg Piece Wt", width: 90 },
  { label: "Net Req Wt", width: 85 },
  { label: "Loss %", width: 75 },
  { label: "Total (Gross) Wt", width: 90 },
  { label: "Unit", width: 60 },
] as const;

/** `<colgroup>` for whichever column set is active — `table-fixed` reads
 *  widths from here, not from `<th>`/`<td>` content, so this is the ONE
 *  place a column's width is declared. */
function EntryRegisterGridCols({ cols }: { cols: readonly { label: string; width: number }[] }) {
  return (
    <colgroup>
      {cols.map((c) => (
        <col key={c.label} style={{ width: c.width }} />
      ))}
    </colgroup>
  );
}

function EntryRegisterView({
  data,
  thumbnail,
}: {
  data: EntryRegister | { refused: string } | null;
  thumbnail: ReportStyleImage | null;
}) {
  const [viewMode, setViewMode] = useState<"detailed" | "summary">("detailed");

  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }

  return (
    <div>
      <ExportBar pdf={(output) => exportEntryRegisterPdf(data, output, thumbnail?.url ?? null)} />

      <Letterhead title="Fabric BOM Entry Register" header={data.header} />
      <EntryRegisterFactsRow header={data.header} thumbnail={thumbnail} />
      <QuantityBand header={data.header} excessAsPct />

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
      {/* THE YARN & FABRIC LOOK (user 2026-09-29) — the PDF's filled bar with
          the register's gross total; rows banded per assort colour. */}
      <SectionBar
        first
        title="Fabric Requirement — Colour · Component · Size"
        right={`${fmtNumber(data.grandTotal.grossWt)} gross`}
      />
      <ReportTable fixed>
        <EntryRegisterGridCols cols={viewMode === "detailed" ? ENTRY_GRID_DETAILED_COLS : ENTRY_GRID_SUMMARY_COLS} />
        <thead>
          <tr>
            {(viewMode === "detailed" ? ENTRY_GRID_DETAILED_COLS : ENTRY_GRID_SUMMARY_COLS).map((c) => (
              <Th key={c.label} right={NUMERIC_ENTRY_COLS.has(c.label)}>
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.groups.map((group, gi) => (
            <EntryColourRows key={group.combo ?? "unassigned"} group={group} viewMode={viewMode} band={gi % 2 === 1} />
          ))}
          <tr className="font-semibold" style={totalRowStyle()}>
            <Td colSpan={3} className="truncate font-semibold">GRAND TOTAL</Td>
            <Td colSpan={viewMode === "detailed" ? 5 : 2}>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.cutQty)}</Td>
            <Td colSpan={viewMode === "detailed" ? 2 : 1}>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.netReqWt)}</Td>
            <Td>{""}</Td>
            <Td right mono className="font-semibold">{fmtNumber(data.grandTotal.grossWt)}</Td>
            <Td>{""}</Td>
          </tr>
        </tbody>
      </ReportTable>

      <div className="mb-6" />

      <SectionBar first title="Process Sequence & Stage Loss Ledger" />
      <ReportTable>
        <thead>
          <tr>
            <Th>Class</Th>
            <Th>Item</Th>
            {/* THE BRANCH (0528): a route split "Assort Color Wise" /
                "Component Wise" prints one row per step per branch, exactly
                as declared — never rolled up. "—" on a unified route. */}
            <Th>Colour</Th>
            <Th>Component</Th>
            <Th>Stage</Th>
            <Th>Process</Th>
            <Th right>Loss %</Th>
          </tr>
        </thead>
        <tbody>
          {data.stageLedger.map((r, i) => (
            <tr key={i} style={stripeRow(i)}>
              <Td>{r.className}</Td>
              <Td>{r.itemName}</Td>
              <Td>{r.combo ?? "—"}</Td>
              <Td>{r.componentName ?? "—"}</Td>
              {/* The stage as the Yarn report's badge (GREIGE / DYED …). */}
              <Td>{r.stageName ? <StageBadge state={r.stageName.toUpperCase()} /> : "—"}</Td>
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
  "Cut Qty",
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
  band,
}: {
  group: EntryRegister["groups"][number];
  viewMode: "detailed" | "summary";
  /** Every other assort colour sits on the colourway band (2026-09-29), the
   *  PDF's own banding — one colour reads as one block. */
  band: boolean;
}) {
  const label = group.combo || "Unassigned";
  const bg = { background: band ? COLOURWAY_BAND : "#ffffff" };
  return (
    <>
      {group.components.map((comp) =>
        viewMode === "detailed" ? (
          <EntryComponentDetailedRows key={comp.key} colour={label} comp={comp} rowStyle={bg} />
        ) : (
          <EntryComponentSummaryRow key={comp.key} colour={label} comp={comp} rowStyle={bg} />
        ),
      )}
      {/* THE COLOUR SUBTOTAL IS THE COARSER LEVEL, and has to read as one —
          `border-y-2` plus a darker tint than the component subtotal beneath
          it, so a reader scanning down the table feels the grouping change
          rather than seeing one undifferentiated grey band repeated at every
          level (found 2026-09-11: component- and colour-level subtotals were
          sharing one flat tint, which is what "needs a professional look"
          was pointing at — a hierarchy that looks the same at every level
          reads as no hierarchy at all). */}
      {/* 2026-09-29: in the section's tone, as the PDF prints it; the
          component subtotal above stays grey, so the two levels still differ. */}
      <tr className="font-semibold uppercase tracking-wide" style={totalRowStyle()}>
        <Td colSpan={3} className="truncate font-semibold">{label} — subtotal</Td>
        <Td colSpan={viewMode === "detailed" ? 5 : 2}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.cutQty)}</Td>
        <Td colSpan={viewMode === "detailed" ? 2 : 1}>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.netReqWt)}</Td>
        <Td>{""}</Td>
        <Td right mono className="font-semibold">{fmtNumber(group.subtotal.grossWt)}</Td>
        <Td>{""}</Td>
      </tr>
    </>
  );
}

function EntryComponentDetailedRows({
  colour,
  comp,
  rowStyle,
}: {
  colour: string;
  comp: EntryRegisterComponentGroup;
  rowStyle: React.CSSProperties;
}) {
  const componentLabel = comp.componentNames.join(", ") || "—";
  return (
    <>
      {comp.sizes.map((s, i) => (
        <tr key={i} style={rowStyle}>
          <Td>
            <span className="flex min-w-0 items-center">
              <Swatch name={colour} />
              <Truncated text={colour} />
            </span>
          </Td>
          <Td><Truncated text={componentLabel} /></Td>
          <Td><Truncated text={comp.fabricName} /></Td>
          <Td><ItemFormBadge form={comp.itemForm} /></Td>
          <Td right mono>{comp.gsm != null ? fmtNumber(comp.gsm) : "—"}</Td>
          <Td>{s.sizeLabel}</Td>
          <Td mono>{s.dia != null && String(s.dia).trim() ? String(s.dia) : "—"}</Td>
          <Td right mono>{s.purchaseWidth != null ? fmtNumber(s.purchaseWidth) : "—"}</Td>
          <Td right mono>{fmtNumber(s.cutQty)}</Td>
          <Td right mono>{s.pieceWt != null ? fmtNumber(s.pieceWt) : "—"}</Td>
          <Td right mono>{s.wastagePct != null ? `${s.wastagePct}%` : "—"}</Td>
          <Td right mono>{fmtNumber(s.netReqWt)}</Td>
          <Td right mono>
            <span className="inline-flex items-center">
              {s.lossPct != null ? `${s.lossPct.toFixed(2)}%` : <RouteAbstain reason={comp.routeRefusal} />}
              {comp.lossChain.length > 0 && <LossChainInfo chain={comp.lossChain} />}
            </span>
          </Td>
          <Td right mono>{fmtNumber(s.grossWt)}</Td>
          <Td>{s.uomCode ?? "—"}</Td>
        </tr>
      ))}
      {/* THE FINER LEVEL — lighter than the colour subtotal below it in
          `EntryColourRows` on purpose, italic rather than uppercase, so the
          two subtotal levels read as a hierarchy rather than one repeated
          band. See that row's own note. */}
      <tr className="bg-[#f6f7f9] italic text-[#5b6472]">
        <Td colSpan={3} className="truncate italic">{componentLabel} — subtotal</Td>
        <Td colSpan={5}>{""}</Td>
        <Td right mono className="font-medium not-italic text-foreground">{fmtNumber(comp.subtotal.cutQty)}</Td>
        <Td colSpan={2}>{""}</Td>
        <Td right mono className="font-medium not-italic text-foreground">{fmtNumber(comp.subtotal.netReqWt)}</Td>
        <Td>{""}</Td>
        <Td right mono className="font-medium not-italic text-foreground">{fmtNumber(comp.subtotal.grossWt)}</Td>
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
function EntryComponentSummaryRow({
  colour,
  comp,
  rowStyle,
}: {
  colour: string;
  comp: EntryRegisterComponentGroup;
  rowStyle: React.CSSProperties;
}) {
  const pieceWts = comp.sizes.map((s) => s.pieceWt).filter((w): w is number => w != null);
  const avgPieceWt = pieceWts.length > 0 ? pieceWts.reduce((a, b) => a + b, 0) / pieceWts.length : null;
  const lossPct = comp.subtotal.netReqWt !== 0 ? (comp.subtotal.grossWt / comp.subtotal.netReqWt - 1) * 100 : null;
  const uomCode = comp.sizes.find((s) => s.uomCode)?.uomCode ?? null;
  return (
    <tr style={rowStyle}>
      <Td>
        <span className="flex min-w-0 items-center">
          <Swatch name={colour} />
          <Truncated text={colour} />
        </span>
      </Td>
      <Td><Truncated text={comp.componentNames.join(", ") || "—"} /></Td>
      <Td><Truncated text={comp.fabricName} /></Td>
      <Td><ItemFormBadge form={comp.itemForm} /></Td>
      <Td right mono>{comp.gsm != null ? fmtNumber(comp.gsm) : "—"}</Td>
      <Td right mono>{fmtNumber(comp.subtotal.cutQty)}</Td>
      <Td right mono>{avgPieceWt != null ? fmtNumber(avgPieceWt) : "—"}</Td>
      <Td right mono>{fmtNumber(comp.subtotal.netReqWt)}</Td>
      <Td right mono>
        <span className="inline-flex items-center">
          {lossPct != null ? `${lossPct.toFixed(2)}%` : <RouteAbstain reason={comp.routeRefusal} />}
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
/** The "—" a Loss % cell prints when no ladder applied — and, when a route
 *  WAS declared but refused this entry (its panels run different "Component
 *  Wise" routes), the reason on hover, marked so the dash is not mistaken for
 *  "no route". The PDF prints the same dash; the sentence is on screen only. */
function RouteAbstain({ reason }: { reason: string | null }) {
  if (!reason) return <>—</>;
  return (
    <span title={reason} className="cursor-help text-amber-700">
      ⚠ —
    </span>
  );
}

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

/** GREY / RFD / DYED, coloured — so a warehouse or mill supervisor reads the
 *  state at a glance rather than parsing a word in a dense table. Falls back
 *  to a neutral tone for any other stage-state word rather than refusing to
 *  render one this app hasn't seen yet. */
/**
 * The ledger's `Details` cell — the cloth, its composition, its form and GSM,
 * with the knitting floor's `[YD Combo Name]` beneath.
 *
 * The SAME sentence the PDF builds (`detailsCell` in reports-export.ts), set
 * differently on purpose: here the combo name is its own tagged line, there a
 * second text line. That is why the parts arrive separately on
 * `StageBreakdownLine` rather than pre-joined by the report.
 *
 * A COMPOSITION THE NAME ALREADY STATES IS NOT REPEATED — this app's fabric
 * masters are named for their blend ("SOLID CHAMBRAY (10'S COMBED COTTON)
 * 100%") where legacy's are not, so appending it unconditionally printed the
 * same phrase twice. Compared with punctuation stripped, because the two
 * strings are generated by different code and differ in exactly that. A
 * yarn-dyed cloth's COLOUR-WISE split is in no name, so it always survives.
 */
function DetailsCell({ line }: { line: StageBreakdownLine }) {
  const squash = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mixing =
    line.mixingText && !squash(line.fabricName).includes(squash(line.mixingText)) ? line.mixingText : null;
  const tail = [line.formLabel, line.gsm != null ? `${fmtNumber(line.gsm)} GSM` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <span>
      {line.fabricName}
      {mixing ? <span className="text-[#5b6472]"> {mixing}</span> : null}
      {tail ? <span className="text-[#8b95a3]"> / {tail}</span> : null}
      {line.ydComboName ? (
        <span className="ml-1 rounded bg-[#eaf7fd] px-1 font-mono text-[10.5px] text-[#037bb8]">
          [{line.ydComboName}]
        </span>
      ) : null}
    </span>
  );
}

/** The ledger's `Dia/Size` cell — the dia, and on a per-size DYEING line the
 *  size after it ("30 / M"); a dash when neither is known. Shared wording with
 *  the PDF (`diaSizeCell` in reports-export.ts). */
function diaSizeText(l: StageBreakdownLine): string {
  const dia = l.dia != null && String(l.dia).trim() ? String(l.dia) : null;
  return [dia, l.sizeLabel].filter(Boolean).join(" / ") || "—";
}

function RequirementReportView({
  data,
  thumbnail,
}: {
  data: YarnFabricRequirementReport | { refused: string } | null;
  thumbnail: ReportStyleImage | null;
}) {
  /* HOOKS ABOVE THE EARLY RETURN BELOW, ALWAYS (AGENTS.md's standing rule —
     this exact file's sibling screen has taken production down five times
     over this). `data` starts null while the fetch is in flight and can
     resolve to a refusal, so every piece of view state this component owns
     has to exist before either of those branches, not after. */
  const [openYarn, setOpenYarn] = useState<string | null>(null);

  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }

  const openYarnLine = data.yarns.find((y) => y.itemId === openYarn) ?? null;
  /* NO COLLAPSE (client 2026-09-20: "that collapse all no need") — every
     process section is always open; its bar is a heading, not a toggle.
     Sections stay KEYED BY `processId`, never by the name: two processes may
     share a label, and React refuses duplicate keys. */

  return (
    <div>
      <ExportBar pdf={(output) => exportYarnRequirementPdf(data, output, thumbnail?.url ?? null)} />

      <Letterhead title="Yarn &amp; Fabric Requirement Report" header={data.header} stageStripe />
      <YarnReportFactsRow header={data.header} thumbnail={thumbnail} />
      <QuantityBand header={data.header} />
      <StageKey />

      {/* NO PROCUREMENT VIEW (requirement-report ticket, 2026-09-20). The
          Yarn & Fabric Requirement Report already carries the purchase AND the
          process weights, so a second "Procurement View" of the same figures
          was redundant — the report is always shown whole, the stage ledger
          included. */}
      <div className="mb-6">
        <SectionHeader tone={STAGE_STYLES.yarn}>Yarn Purchase Requirement</SectionHeader>
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
                <Td right mono wrap={!!y.refusalReason} className={y.refusalReason ? "text-destructive" : ""}>
                  {y.purchaseQty != null ? fmtNumber(y.purchaseQty) : (y.refusalReason ?? "—")}
                </Td>
              </tr>
            ))}
            {data.yarnGrandTotal && (
              <tr className="font-semibold" style={{ background: STAGE_STYLES.yarn.tint, color: STAGE_STYLES.yarn.ink }}>
                <Td colSpan={4}>Total Yarn Purchase Requirement</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnGrandTotal.qty)}</Td>
                <Td>{""}</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnGrandTotal.qty)}</Td>
              </tr>
            )}
            {/* CONVERSION — DIRECTLY UNDER YARN PURCHASE (client spec
                2026-09-26): unravelling dyed loose fabric into dyed yarn is a
                yarn process, so it reads with the yarns. Plan Wt is the
                converted yarn a colour needs, To Ordered the loose fabric
                unravelled for it. `?? []` — a frozen V_final copy predates it. */}
            {(data.conversion ?? []).map((l, i) => (
              <tr key={`conv-${i}`} className="odd:bg-white even:bg-[#fafbfc]">
                <Td>{i === 0 ? <StageBadge state="DYED" /> : ""}</Td>
                <Td>{i === 0 ? "CONVERSION" : ""}</Td>
                <Td wrap>
                  {l.yarnName}
                  <span className="block text-[11px] text-muted-foreground">from {l.looseFabricName}</span>
                </Td>
                <Td>{l.colour ?? "—"}</Td>
                <Td right mono>{fmtNumber(l.plannedWt)}</Td>
                {/* Same shape as the YARN DYEING rows below ("5.00%"), which
                    share this Loss % column — one column, one format. */}
                <Td right mono>{l.lossPct != null ? `${l.lossPct.toFixed(2)}%` : "—"}</Td>
                <Td right mono>{fmtNumber(l.toOrderedWt)}</Td>
              </tr>
            ))}
            {/* YARN DYEING — the legacy printout's second Yarn Requirement
                block, in the SAME table as the purchase rows because that is
                what it is: the grey yarn above, and which colours of it the
                dye house is given. Absent entirely on an all-solid document
                rather than drawn empty. See `YarnDyeingLine` for why every
                colour of one yarn shows that yarn's own single loss today. */}
            {data.yarnDyeing.map((l, i) => (
              <tr key={`dye-${i}`} className="odd:bg-white even:bg-[#fafbfc]">
                <Td>{i === 0 ? <StageBadge state="DYED" /> : ""}</Td>
                <Td>{i === 0 ? "YARN DYEING" : ""}</Td>
                <Td>{l.yarnName}</Td>
                <Td>{l.colorName}</Td>
                <Td right mono>{fmtNumber(l.plannedWt)}</Td>
                <Td right mono>{l.lossPct ? `${l.lossPct.toFixed(2)}%` : "—"}</Td>
                <Td right mono>{fmtNumber(l.toOrderedWt)}</Td>
              </tr>
            ))}
            {data.yarnDyeingTotal && (
              <tr className="font-semibold" style={{ background: STAGE_STYLES.dyed.tint, color: STAGE_STYLES.dyed.ink }}>
                <Td colSpan={4}>Total Yarn Dyeing Requirement</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnDyeingTotal.plannedWt)}</Td>
                <Td right mono>{avgLoss(data.yarnDyeing, data.yarnDyeingTotal.plannedWt, data.yarnDyeingTotal.toOrderedWt)}</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.yarnDyeingTotal.toOrderedWt)}</Td>
              </tr>
            )}
            {/* FABRIC PURCHASE (0564) — Default Rule 2's demand, in the SAME
                table as the yarn it REPLACES. A cloth the factory does not
                knit buys no yarn at all, so it is absent from the rows above;
                if this block were a section of its own, a reader could total
                the yarn table and believe they had the whole demand. The Yarn
                Description column carries the CLOTH's name here, and the Type
                column names which roll is being bought — greige or dyed are
                different suppliers and different money. Absent entirely on an
                all-Rule-1 document, like YARN DYEING above it. */}
            {data.clothPurchase.map((l, i) => (
              <tr key={`cloth-${i}`} className="odd:bg-white even:bg-[#fafbfc]">
                <Td>{i === 0 ? <StageBadge state={l.source === "dyed_purchase" ? "DYED" : "GREY"} /> : ""}</Td>
                <Td>{i === 0 ? "FABRIC PURCHASE" : ""}</Td>
                <Td>
                  {l.fabricName}
                  {l.component && <span className="ml-1 text-muted-foreground">· {l.component}</span>}
                </Td>
                <Td>{l.combo ?? "—"}</Td>
                <Td right mono>{fmtNumber(l.netWt)}</Td>
                <Td right mono>
                  {/* THE LOSS THE LADDER IMPLIES, never a second figure — the
                      same reading the YARN DYEING rows use. A dash rather
                      than 0.00% where the route declares nothing after the
                      roll lands: "no loss was declared" and "the loss is
                      zero" are the same arithmetic and different sentences. */}
                  {l.purchaseWt > l.netWt
                    ? `${(((l.purchaseWt - l.netWt) / l.purchaseWt) * 100).toFixed(2)}%`
                    : "—"}
                </Td>
                <Td right mono>{fmtNumber(l.purchaseWt)}</Td>
              </tr>
            ))}
            {data.clothPurchaseTotal && (
              <tr className="font-semibold" style={{ background: STAGE_STYLES.greige.tint, color: STAGE_STYLES.greige.ink }}>
                <Td colSpan={4}>
                  Total Fabric Purchase Requirement
                  {data.clothPurchaseTotal.uomCode ? ` (${data.clothPurchaseTotal.uomCode})` : ""}
                </Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td right mono className="font-semibold">{fmtNumber(data.clothPurchaseTotal.qty)}</Td>
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
                  <Td>{[c.combo, c.component].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td right mono>{fmtNumber(c.wt)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      )}

      <div>
        <SectionHeader>Process Stage Ledger</SectionHeader>
        {/* NO FABRIC PURCHASE SECTIONS HERE (user 2026-09-26, screenshot 3114:
            "DYED FABRIC PURCHASE — this is duplicated"). A bought cloth is
            already the Fabric Purchase Requirement block above, line for line;
            the ledger is for the processes the cloth goes THROUGH. Left out
            of the print only — the Budget and Fabric T&A still read the
            section off the report's data. */}
        {data.stageBreakdown.filter((sec) => !sec.isClothPurchase).map((g, gi) => {
          /* THE SECTION WEARS ITS STAGE (2026-09-20) — tag, tint and rule. */
          const tone = sectionStyle(g.stages, g.isPrint);
          /* ONE BAND PER ASSORT COLOURWAY, alternating. */
          const runOf: number[] = [];
          /* A perComponent section bands by the component's colour (2026-09-26). */
          const bandOf = (l: (typeof g.lines)[number]) => (g.perComponent ? (l.band ?? null) : l.combo);
          g.lines.forEach((l, i) => runOf.push(i === 0 ? 0 : runOf[i - 1] + (bandOf(g.lines[i - 1]) !== bandOf(l) ? 1 : 0)));
          return (
            <div key={g.processId}>
              <SectionBar tone={tone} title={g.processName} right={fmtNumber(g.toOrderedTotal)} first={gi === 0} />
              <ReportTable>
                <thead>
                  {/* LEGACY'S OWN COLUMNS — `Color` leads (the CLOTH's
                      colour, or its YD Combo Name; the assort colourway
                      still bands the rows beneath), `Dia/Size` and the
                      `Nos/Mtrs` counts sit beside each weight. A cloth
                      bought by weight leaves the count blank. */}
                  {/* TWO HEADER ROWS, the PDF's own shape — "Planned" and "To
                      Ordered" each over their Nos/Mtrs · Wt pair. Four long
                      labels in one row were a large part of what pushed this
                      table past the pane's width (2026-09-20). */}
                  <tr>
                    <Th rowSpan={2}>Color</Th>
                    <Th rowSpan={2}>Details</Th>
                    <Th rowSpan={2}>Component</Th>
                    <Th rowSpan={2} right>Dia/Size</Th>
                    {/* DYEING / DYED FABRIC PURCHASE list each component PER SIZE
                        (2026-09-29) — the garments of that size beside it. */}
                    {g.perComponent && <Th rowSpan={2} right>Pcs</Th>}
                    <Th colSpan={2} center>Planned</Th>
                    {/* DYEING / DYED FABRIC PURCHASE only (client spec
                        2026-09-26) — each component's grams per garment. */}
                    {g.perComponent && <Th rowSpan={2} right>Piece Wt (g)</Th>}
                    <Th rowSpan={2} right>Loss %</Th>
                    <Th colSpan={2} center>To Ordered</Th>
                  </tr>
                  <tr>
                    <Th right>Nos/Mtrs</Th>
                    <Th right>Wt</Th>
                    <Th right>Nos/Mtrs</Th>
                    <Th right>Wt</Th>
                  </tr>
                </thead>
                <tbody>
                  {/* GROUPED UNDER EACH ASSORT COLOUR when the section
                      holds more than one (client spec, 2026-09-15) — the
                      lines arrive sorted by colour, so a subtotal row is
                      drawn where the colour changes. One colour, one flat
                      list, no band: nothing to total under. */}
                  {g.lines.map((l, i) => {
                    const colourChanges = i === g.lines.length - 1 || bandOf(g.lines[i + 1]) !== bandOf(l);
                    const subtotal = g.byColour.length > 1 && colourChanges ? g.byColour.find((c) => c.combo === bandOf(l)) : undefined;
                    return (
                      <Fragment key={i}>
                        <tr style={{ background: runOf[i] % 2 === 1 ? COLOURWAY_BAND : "#ffffff" }}>
                          {/* A SIZE RUN NAMES ITS CLOTH ONCE (2026-09-29) — the PDF's
                              `sizeRunContinues`; the size rows under it stay blank. */}
                          {sizeRunContinues(g.lines, i) ? (
                            <>
                              <Td>{""}</Td>
                              <Td>{""}</Td>
                              <Td>{""}</Td>
                            </>
                          ) : (
                            <>
                              <Td>
                                <Swatch name={l.fabricColour} />
                                {l.fabricColour ?? "—"}
                              </Td>
                              <Td>
                                <DetailsCell line={l} />
                              </Td>
                              <Td>{l.component ?? "—"}</Td>
                            </>
                          )}
                          <Td mono>{diaSizeText(l)}</Td>
                          {g.perComponent && <Td right mono>{l.pieces != null ? fmtNumber(l.pieces) : "—"}</Td>}
                          <Td right mono>{l.plannedNos != null ? fmtNumber(l.plannedNos) : "—"}</Td>
                          <Td right mono>{fmtNumber(l.plannedWt)}</Td>
                          {g.perComponent && (
                            <Td right mono>{l.pieceWtG != null ? fmtNumber(l.pieceWtG) : "—"}</Td>
                          )}
                          <Td right mono>{l.lossPct.toFixed(2)}%</Td>
                          <Td right mono>{l.toOrderedNos != null ? fmtNumber(l.toOrderedNos) : "—"}</Td>
                          <Td right mono>{fmtNumber(l.toOrderedWt)}</Td>
                        </tr>
                        {subtotal && (
                          <tr className="bg-[#f6f7f9] italic text-[#5b6472]">
                            <Td colSpan={g.perComponent ? 6 : 5} className="italic">{subtotal.combo || "No colour"} — subtotal</Td>
                            <Td right mono className="font-medium not-italic text-foreground">{fmtNumber(subtotal.plannedTotal)}</Td>
                            <Td colSpan={g.perComponent ? 3 : 2}>{""}</Td>
                            <Td right mono className="font-medium not-italic text-foreground">{fmtNumber(subtotal.toOrderedTotal)}</Td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr className="font-semibold" style={{ background: tone.tint, color: tone.ink }}>
                    <Td colSpan={g.perComponent ? 6 : 5}>Grand Total</Td>
                    <Td right mono className="font-semibold">{fmtNumber(g.plannedTotal)}</Td>
                    {g.perComponent && <Td>{""}</Td>}
                    {/* 0606 — "Avg" only when a colour-wise step put different
                        losses in this section; same figure as the PDF. */}
                    <Td right mono>{avgLoss(g.lines, g.plannedTotal, g.toOrderedTotal)}</Td>
                    <Td>{""}</Td>
                    <Td right mono className="font-semibold">{fmtNumber(g.toOrderedTotal)}</Td>
                  </tr>
                </tbody>
              </ReportTable>
            </div>
          );
        })}
        {/* WEIGHTS THE LEDGER COULD NOT PLACE — named, never dropped. */}
        {data.stageLedgerRefusals.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
            {data.stageLedgerRefusals.map((r, i) => (
              <li key={i}>⚠ {r}</li>
            ))}
          </ul>
        )}
      </div>
      <FabricAllocationSection allocation={data.allocation} />
    </div>
  );
}

/**
 * FABRIC ALLOCATION (CUTTING) — the requirement report's last section (client
 * 2026-09-19, 3A): per colourway, component set and dia, the cloth that reaches
 * the cutting table. Net Cutting Wt is before the cutting-room wastage and
 * Allocated Wt includes it; both come off the Entry Register
 * (`fabricAllocationOf`). The PDF prints the same rows in the same order.
 */
function FabricAllocationSection({ allocation }: { allocation: YarnFabricRequirementReport["allocation"] }) {
  /* One band per colourway run, alternating (2026-09-20). */
  const allocBand: boolean[] = [];
  if (!isReportRefusal(allocation)) {
    let run = 0;
    allocation.rows.forEach((r, i) => {
      if (i > 0 && allocation.rows[i - 1].combo !== r.combo) run++;
      allocBand.push(run % 2 === 1);
    });
  }
  return (
    <div className="mt-3">
      <SectionHeader tone={STAGE_STYLES.cutting}>Fabric Allocation (Cutting)</SectionHeader>
      {isReportRefusal(allocation) ? (
        <div className="border-x border-b border-border bg-white px-4 py-3 text-[12.5px] text-destructive">
          {allocation.refused}
        </div>
      ) : allocation.rows.length === 0 ? (
        <div className="border-x border-b border-border bg-white px-4 py-3 text-[12.5px] text-muted-foreground">
          No cutting requirement on this BOM yet — fill the Manual tab and Save.
        </div>
      ) : (
        <ReportTable>
          <thead>
            <tr>
              <Th>Component</Th>
              <Th>Garment Colourway</Th>
              <Th>Fabric</Th>
              <Th right>Net Cutting Wt (Kg)</Th>
              <Th>Finished Dia / GSM</Th>
              <Th right>Allocated Wt (Kg)</Th>
            </tr>
          </thead>
          <tbody>
            {allocation.rows.map((r, i) => (
              <tr key={`fa-${i}`} style={{ background: allocBand[i] ? COLOURWAY_BAND : "#ffffff" }}>
                <Td>{r.component || "—"}</Td>
                <Td>
                  <Swatch name={r.combo} />
                  {r.combo || "All colours"}
                </Td>
                <Td>{r.fabricName}</Td>
                <Td right mono>{fmtNumber(r.netCuttingWt)}</Td>
                <Td mono>{[r.dia, r.gsm != null ? `${r.gsm} GSM` : null].filter(Boolean).join(" / ") || "—"}</Td>
                <Td right mono className="font-semibold">{fmtNumber(r.allocatedWt)}</Td>
              </tr>
            ))}
            <tr className="font-semibold" style={{ background: STAGE_STYLES.cutting.tint, color: STAGE_STYLES.cutting.ink }}>
              <Td colSpan={3}>Total</Td>
              <Td right mono className="font-semibold">{fmtNumber(allocation.netCuttingWt)}</Td>
              <Td>{""}</Td>
              <Td right mono className="font-semibold">{fmtNumber(allocation.allocatedWt)}</Td>
            </tr>
          </tbody>
        </ReportTable>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report 3 — Printing Requirement (client 2026-09-19)
// ---------------------------------------------------------------------------

/**
 * "A separate, dedicated printing requirement report displaying the exact
 * weight sent for printing." The PRINT sections of the Yarn & Fabric
 * Requirement ledger, lifted out and grouped per assort colourway —
 * `YarnFabricRequirementReport.printing`. Only printed colourways and
 * components appear, because the engine keeps the print stage out of every
 * unprinted group's ladder (`routeForPrint`); this view filters nothing.
 */
function PrintRequirementView({
  data,
  thumbnail,
}: {
  data: YarnFabricRequirementReport | { refused: string } | null;
  thumbnail: ReportStyleImage | null;
}) {
  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-destructive">{data.refused}</div>;
  }
  const p = data.printing;
  return (
    <div>
      {p.groups.length > 0 && (
        <ExportBar pdf={(output) => exportPrintRequirementPdf(data, output, thumbnail?.url ?? null)} />
      )}
      <Letterhead title="Printing Requirement" header={data.header} stageStripe />
      <YarnReportFactsRow header={data.header} thumbnail={thumbnail} />
      <QuantityBand header={data.header} />
      <div className="mt-3">
        <SectionHeader tone={STAGE_STYLES.print}>Fabric Sent for Printing</SectionHeader>
        {p.groups.length === 0 ? (
          /* EMPTY-AND-EXPLAIN — an empty printing report must not read as
             "nothing to print" when the real cause is a route with no Printing
             step (which Save now refuses) or an order with no print. */
          <div className="border-x border-b border-border bg-white px-4 py-3 text-[12.5px] text-muted-foreground">
            No fabric on this BOM is sent for printing — no fabric line carries a print from Order
            Entry, or no Fabric Process route has a Printing step.
          </div>
        ) : (
          <ReportTable>
            <thead>
              <tr>
                <Th>Assort Colour</Th>
                <Th>Fabric</Th>
                <Th>Component</Th>
                <Th>Print</Th>
                <Th>Process</Th>
                <Th>Dia/Size</Th>
                {/* Client 2026-09-19 (1A) — what the sent weight rests on. See
                    `PrintRequirementRow.cutPieces` for why these never total. */}
                <Th right>Cut Pcs</Th>
                <Th right>Piece Wt (Kg)</Th>
                <Th right>Wt Sent for Printing</Th>
                <Th right>Loss %</Th>
                <Th right>Wt After Printing</Th>
              </tr>
            </thead>
            <tbody>
              {p.groups.map((g, gi) => (
                <Fragment key={`pg-${g.combo}`}>
                  {g.rows.map((r, i) => (
                    <tr key={`pr-${g.combo}-${i}`} style={{ background: gi % 2 === 1 ? COLOURWAY_BAND : "#ffffff" }}>
                      <Td>
                        <Swatch name={r.combo} />
                        {r.combo || "All colours"}
                      </Td>
                      <Td>{r.fabricName}</Td>
                      <Td>{r.component || "—"}</Td>
                      <Td>{r.print || "—"}</Td>
                      <Td>{r.processName}</Td>
                      <Td>{r.dia || "—"}</Td>
                      <Td right mono>{r.cutPieces == null ? "—" : fmtNumber(r.cutPieces)}</Td>
                      <Td right mono>{r.pieceWt == null ? "—" : r.pieceWt.toFixed(3)}</Td>
                      <Td right mono className="font-semibold">{fmtNumber(r.sentWt)}</Td>
                      <Td right mono>{r.lossPct.toFixed(2)}%</Td>
                      <Td right mono>{fmtNumber(r.receivedWt)}</Td>
                    </tr>
                  ))}
                  {p.groups.length > 1 && (
                    <tr className="font-semibold" style={{ background: STAGE_STYLES.print.tint, color: STAGE_STYLES.print.ink }}>
                      <Td colSpan={8}>{g.combo || "All colours"} total</Td>
                      <Td right mono>{fmtNumber(g.sentWt)}</Td>
                      <Td>{""}</Td>
                      <Td right mono>{fmtNumber(g.receivedWt)}</Td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="font-semibold" style={{ background: STAGE_STYLES.print.tint, color: STAGE_STYLES.print.ink }}>
                <Td colSpan={8}>Total Sent for Printing</Td>
                <Td right mono className="font-semibold">{fmtNumber(p.sentWt)}</Td>
                <Td>{""}</Td>
                <Td right mono className="font-semibold">{fmtNumber(p.receivedWt)}</Td>
              </tr>
            </tbody>
          </ReportTable>
        )}
      </div>
    </div>
  );
}
