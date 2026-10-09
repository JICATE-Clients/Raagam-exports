/**
 * The Fabric BOM reports as documents — PDF download and PRINT, and nothing else.
 *
 * ## NO EXCEL, ON PURPOSE (client spec 2026-09-19)
 *
 * These are requirement documents that go to suppliers and the floor, and the
 * client removed every spreadsheet export from them: a CSV opens in Excel, is
 * edited, and circulates as if the app had issued it — tampered requirement
 * figures with our header on them. A PDF is the document as issued. The three
 * `export…Csv` functions that lived here were deleted, not hidden, so no screen
 * can wire one back by accident. (The Fabric Requirement Sheet, a different
 * report, keeps its own Excel button — the client's spec named this report.)
 *
 * "Print" is the SAME PDF opened in a new tab with the print dialog raised
 * (`output: "print"`), so what is printed and what is downloaded are one
 * document, not a browser print of the screen beside it.
 *
 * Browser-only (blob downloads): call from a `"use client"` island, same as
 * the sibling file. Landscape A4, mono `jspdf-autotable` theme, letterhead +
 * facts strip + page footer — copied from `fabric-requirement/export.ts`
 * rather than re-derived, so a reader who knows one export knows the other.
 *
 * IT PRINTS THE STORED FIGURES THE SHEET ALREADY RENDERS, never a recompute —
 * both functions below take the exact `EntryRegister` /
 * `YarnFabricRequirementReport` the on-screen Sheet holds, so the file and the
 * screen can never disagree the way two implementations of one export would.
 */
import { drawCadPendingStamp } from "@/lib/orders/cad-lifecycle/stamp";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtNumber } from "@/lib/format";
import type {
  BomDocHeader,
  EntryRegister,
  StageBreakdownLine,
  YarnFabricRequirementReport,
} from "./reports";
import { isReportRefusal } from "./report-refusal";
import { sectionAverageLoss } from "./color-loss";

/** "Avg 4.34%" for a total row whose lines carry different losses, else "". */
function avgLossText(
  lines: readonly { lossPct: number | null | undefined }[],
  planned: number,
  ordered: number,
): string {
  const avg = sectionAverageLoss(lines, planned, ordered);
  return avg == null ? "" : `Avg ${avg.toFixed(2)}%`;
}
/* THE LETTERHEAD LOGO (2026-09-19) — loaded in the browser once per source and
   drawn into every PDF header below. A logo that fails to load prints nothing
   rather than stopping the download. */
import { fitLogo, loadLetterheadImage, type LetterheadImage } from "./letterhead";
import { requirementBuyTiles, requirementRoute } from "./sheet-summary";
/* THE STAGE COLOURS (client 2026-09-20, design A "with colourful
   differentiation") — one palette shared with the on-screen report. */
import {
  COLOURWAY_BAND,
  STAGE_STYLES,
  rgb,
  sectionStyle,
  swatchFor,
  type StageStyle,
} from "./report-colours";
import {
  CONTINUED_TOP,
  ROW_STRIPE,
  STATE_BADGE,
  SWATCH_PADDING,
  drawStateBadge,
  drawSwatch,
  drawCardHeader,
  drawOrderFacts,
  drawQtyEquation,
  drawRouteStrip,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  cardTableHead,
  cardTableStyles,
  paintRow,
  roomFor,
  BRAND,
} from "@/lib/orders/report-pdf-kit";

/* THE LOOK LIVES IN ../report-pdf-kit.ts (2026-09-29) — moved out of this file
   so every order report draws with it. Re-exported for the exporters that
   already import it from here. */
export { CONTINUED_TOP };

export function monoStyles() {
  return { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 };
}
export function monoHead() {
  return { fillColor: [235, 237, 240] as [number, number, number], textColor: 20, fontStyle: "bold" as const };
}

/** How a PDF leaves: saved as a file, or opened for printing. */
export type PdfOutput = "download" | "print";

/**
 * THE PRINT TAB IS OPENED FIRST, before anything is awaited. A browser allows
 * `window.open` only inside the click that asked for it; every exporter below
 * awaits the letterhead logo, and a tab opened after that await can be
 * swallowed by the popup blocker. So the exporter opens an empty tab
 * synchronously and fills it at the end. Null for a download.
 */
export function openPrintTab(output: PdfOutput): Window | null {
  return output === "print" && typeof window !== "undefined" ? window.open("", "_blank") : null;
}

/**
 * Save the PDF, or show it in the tab `openPrintTab` opened with the print
 * dialog raised (`autoPrint`). A print whose tab was blocked falls back to the
 * download — the operator still gets the document, just not the dialog.
 */
export function finishPdf(doc: jsPDF, filename: string, output: PdfOutput, tab: Window | null): void {
  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  doc.save(filename);
}

function stem(prefix: string, header: BomDocHeader): string {
  const key = (header.scNo || header.bomCode || "bom")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}_${key}`;
}

/**
 * THE HEADER THUMBNAIL (2026-09-26) — the style picture the screen shows at the
 * facts' top-left (`pickReportThumbnail`, loaded beside the report and never
 * frozen with it), fitted proportionally into an 86 pt (~1.2 in) square with a
 * thin frame. Returns the width the facts must move right by — 0 when there is
 * no picture, so a report without one is laid out exactly as before.
 */
const THUMB = 86;
const THUMB_GAP = 8;
function drawThumbnail(doc: jsPDF, thumb: LetterheadImage | null, x: number, y: number): number {
  if (!thumb) return 0;
  const { w, h } = fitLogo(thumb, THUMB - 4, THUMB - 4);
  doc.setDrawColor(200);
  doc.setLineWidth(0.4);
  doc.rect(x, y, THUMB, THUMB);
  doc.addImage(thumb.dataUrl, "PNG", x + (THUMB - w) / 2, y + (THUMB - h) / 2, w, h);
  return THUMB + THUMB_GAP;
}




/**
 * `Computed <date>` bottom left and `Page n / m` bottom right.
 *
 * `pageNumbers: false` drops the right half, for a document that already
 * carries its page number where legacy puts it — at the TOP right (see
 * `stampTopPageNumbers`). Two page numbers on one sheet is the kind of detail
 * that makes a reader wonder which one to trust.
 *
 * `computedAt` IS NOT THE PRINT TIME and the two are deliberately both on the
 * Yarn & Fabric Requirement sheet: this one says when the FIGURES were worked
 * out, which can be days before someone prints them.
 */
export function pageFooter(doc: jsPDF, header: BomDocHeader, opts?: { pageNumbers?: boolean }): void {
  const M = 36;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(
      header.computedAt ? `Computed ${fmtDate(header.computedAt)}` : "",
      M,
      doc.internal.pageSize.getHeight() - 20,
    );
    if (opts?.pageNumbers !== false) {
      doc.text(`Page ${p} / ${pages}`, RIGHT, doc.internal.pageSize.getHeight() - 20, { align: "right" });
    }
    /* THE CAD STAMP (0628) on EVERY page — a loose sheet of a multi-page report
       must carry it too. Gated on the header's own flag, so the Material BOM
       export that shares this footer (lib/orders/requirement/export.ts) never
       draws it. A bordered badge, not a watermark: see cad-lifecycle/stamp.ts. */
    if (header.cadPending) drawCadPendingStamp(doc);
  }
}

// ---------------------------------------------------------------------------
// Fabric BOM Entry Register
// ---------------------------------------------------------------------------

// GROUPED BY ASSORT COLOUR then by (fabric, component set) — the Manual tab's
// own counting unit (0494) — with one row per size within each component
// group. Colour and component-level facts (Assort Colour, Component, Fabric,
// Item Form, GSM) are repeated on every size row, the same denormalization
// convention this file already used when the grouping was fabric-only.
const REGISTER_COLUMNS = [
  "Assort Colour",
  "Component",
  "Fabric",
  "Item Form",
  "GSM",
  "Size",
  "Dia/Size",
  "Width",
  "Cut Qty",
  "Piece Wt",
  "Wastage %",
  "Net Req Wt",
  "Loss %",
  "Total (Gross) Wt",
  "Unit",
];

/** What each register row is, for its look (2026-09-29): a size row (banded
 *  per assort colour, `run` counting the colours), or one of the three totals. */
type RegisterRowKind =
  | { kind: "size"; run: number; swatch: string | null }
  | { kind: "component" }
  | { kind: "colour" }
  | { kind: "grand" };

function registerBody(data: EntryRegister): { body: string[][]; totalAt: number[]; kinds: RegisterRowKind[] } {
  const body: string[][] = [];
  const totalAt: number[] = [];
  const kinds: RegisterRowKind[] = [];
  let run = -1;
  for (const cg of data.groups) {
    run++;
    let firstOfColour = true;
    for (const comp of cg.components) {
      const componentLabel = comp.componentNames.join(", ");
      for (const sz of comp.sizes) {
        body.push([
          cg.combo || "",
          componentLabel,
          comp.fabricName,
          comp.itemForm ?? "",
          comp.gsm != null ? fmtNumber(comp.gsm) : "",
          sz.sizeLabel,
          sz.dia ?? "",
          sz.purchaseWidth != null ? fmtNumber(sz.purchaseWidth) : "",
          fmtNumber(sz.cutQty),
          sz.pieceWt != null ? fmtNumber(sz.pieceWt) : "",
          sz.wastagePct != null ? `${sz.wastagePct}%` : "",
          fmtNumber(sz.netReqWt),
          sz.lossPct != null ? `${sz.lossPct.toFixed(2)}%` : "",
          fmtNumber(sz.grossWt),
          sz.uomCode ?? "",
        ]);
        kinds.push({ kind: "size", run, swatch: firstOfColour ? swatchFor(cg.combo) : null });
        firstOfColour = false;
      }
      totalAt.push(body.length);
      kinds.push({ kind: "component" });
      body.push([
        "",
        `${componentLabel || comp.fabricName} — subtotal`,
        "",
        "",
        "",
        "",
        "",
        "",
        fmtNumber(comp.subtotal.cutQty),
        "",
        "",
        fmtNumber(comp.subtotal.netReqWt),
        "",
        fmtNumber(comp.subtotal.grossWt),
        "",
      ]);
    }
    totalAt.push(body.length);
    kinds.push({ kind: "colour" });
    body.push([
      `${cg.combo || "(no colour)"} — subtotal`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      fmtNumber(cg.subtotal.cutQty),
      "",
      "",
      fmtNumber(cg.subtotal.netReqWt),
      "",
      fmtNumber(cg.subtotal.grossWt),
      "",
    ]);
  }
  /* One subtotal per roll form above the grand total (0696) — the same rows the
     on-screen register prints, in the colour-subtotal look. Absent from a
     snapshot frozen before the field existed. */
  for (const t of data.layoutTotals ?? []) {
    totalAt.push(body.length);
    kinds.push({ kind: "colour" });
    body.push([
      `${t.form} — subtotal`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      fmtNumber(t.cutQty),
      "",
      "",
      fmtNumber(t.netReqWt),
      "",
      fmtNumber(t.grossWt),
      "",
    ]);
  }
  totalAt.push(body.length);
  kinds.push({ kind: "grand" });
  body.push([
    "GRAND TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fmtNumber(data.grandTotal.cutQty),
    "",
    "",
    fmtNumber(data.grandTotal.netReqWt),
    "",
    fmtNumber(data.grandTotal.grossWt),
    "",
  ]);
  return { body, totalAt, kinds };
}

export async function exportEntryRegisterPdf(
  data: EntryRegister,
  output: PdfOutput = "download",
  /** The header thumbnail's URL (2026-09-26) — null draws none. */
  thumbUrl: string | null = null,
): Promise<void> {
  const tab = openPrintTab(output);
  const [logo, thumb] = await Promise.all([loadLetterheadImage(data.header.company.logo), loadLetterheadImage(thumbUrl)]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  /* THE SHEET FORMAT (user 2026-09-29, "this is okay apply it") — the shared
     opening (`drawSheetHeader`: masthead, order facts, the quantity as a sum),
     the register's totals as tiles, then each table as a card. 28pt margins,
     the opening's own, so the cards line up under it in landscape too. */
  const M = 28;
  let y = drawSheetHeader(doc, data.header, "Fabric Plan Entry Register", logo, thumb);
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  y = drawSheetLabel(doc, M, y + 2, "This register");
  y = drawSummaryTiles(
    doc,
    y,
    [
      { label: "Net requirement", value: fmtNumber(data.grandTotal.netReqWt), unit: "kg", note: "before process loss", tone: BRAND },
      { label: "Total (gross)", value: fmtNumber(data.grandTotal.grossWt), unit: "kg", note: "to order", tone: BRAND },
      { label: "Colourways", value: String(data.groups.length), note: "assort colours", tone: BRAND },
      {
        label: "Components",
        value: String(data.groups.reduce((sum, g) => sum + g.components.length, 0)),
        note: "fabric · component sets",
        tone: BRAND,
      },
    ],
    M,
  );

  /* THE YARN & FABRIC LOOK (user 2026-09-29) — a filled section bar with the
     register's gross total, the head in its tint, one band per assort colour
     with a swatch on its first row, and the three totals graded: a component
     subtotal bold on grey, a colour subtotal and the grand total in the tone.
     The green rule above stays: this is the one Fabric BOM document that is
     not a requirement (2026-09-20). */
  const tone = BRAND;
  const { body, kinds } = registerBody(data);
  y = roomFor(doc, y, 90, 40);
  const startY = drawCardHeader(
    doc,
    M,
    y + 4,
    RIGHT - M,
    tone,
    "Fabric Requirement — Colour · Component · Size",
    fmtNumber(data.grandTotal.grossWt),
    "Gross",
  );

  autoTable(doc, {
    head: [REGISTER_COLUMNS],
    body,
    startY,
    margin: { left: M, right: M },
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles: {
      // GSM(4), Width(7), Cut Qty(8), Piece Wt(9), Wastage %(10),
      // Net Req Wt(11), Loss %(12), Total (Gross) Wt(13) — every numeric
      // column in REGISTER_COLUMNS; Size(5) is a label, not a figure, and
      // Dia/Size(6) joined it on 0566 — a dia is text now ("23 CM"), so it
      // aligns with the words rather than with the weights.
      4: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
      11: { halign: "right" },
      12: { halign: "right" },
      13: { halign: "right" },
    },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      const k = kinds[d.row.index];
      if (!k) return;
      if (k.kind === "size") {
        d.cell.styles.fillColor = k.run % 2 === 1 ? rgb(COLOURWAY_BAND) : [255, 255, 255];
        if (k.swatch && d.column.index === 0) d.cell.styles.cellPadding = SWATCH_PADDING;
      } else if (k.kind === "component") {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [226, 231, 236];
      } else {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = rgb(tone.tint);
        d.cell.styles.textColor = rgb(tone.ink);
      }
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 0) return;
      const k = kinds[d.row.index];
      if (k?.kind === "size" && k.swatch) drawSwatch(doc, d.cell, k.swatch);
    },
  });

  if (data.stageLedger.length) {
    let ly = roomFor(doc, finalY(doc, y), 90, 40);
    ly = drawCardHeader(doc, M, ly + 12, RIGHT - M, tone, "Process Sequence & Stage Loss Ledger");
    autoTable(doc, {
      head: [["Class", "Item", "Colour", "Component", "Stage", "Process", "Loss %"]],
      body: data.stageLedger.map((r) => [
        r.className,
        r.layoutForm ? `${r.itemName} / ${r.layoutForm}` : r.itemName,
        r.combo ?? "",
        r.componentName ?? "",
        r.stageName ?? "",
        r.processName ?? "",
        r.lossPct != null ? `${r.lossPct.toFixed(2)}%` : "",
      ]),
      startY: ly,
      margin: { left: M, right: M },
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      theme: "plain",
      columnStyles: { 6: { halign: "right" } },
      didParseCell: (d) => {
        paintRow(d, { tone });
        // The stage as the Yarn report's badge (GREIGE / DYED); other words stay text.
        if (d.section === "body" && d.column.index === 4 && STATE_BADGE[String(d.cell.raw ?? "")]) d.cell.text = [];
      },
      didDrawCell: (d) => {
        if (d.section !== "body" || d.column.index !== 4) return;
        const word = String(d.cell.raw ?? "");
        if (STATE_BADGE[word]) drawStateBadge(doc, d.cell, word);
      },
    });
  }

  pageFooter(doc, data.header);
  finishPdf(doc, `${stem("FabricBomEntryRegister", data.header)}.pdf`, output, tab);
}

// ---------------------------------------------------------------------------
// Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------



/**
 * THE SHEET FORMAT'S OPENING (user 2026-09-29, the approved "Raagam Requirement
 * Sheet") — masthead, the order's facts beside the style picture, and the
 * quantity drawn as the sum it is. Replaces `drawLegacyRequirementHeader`'s RP
 * bordered grid for the documents that have moved to the new format; the facts
 * are the same ones, in the client's words (Style / Description, Earlier
 * Shipment with Delivery under it). Returns the Y below the quantity block.
 */
export function drawSheetHeader(
  doc: jsPDF,
  h: BomDocHeader,
  kind: string,
  logo: LetterheadImage | null,
  thumb: LetterheadImage | null = null,
): number {
  const M = 28;
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: h.company.name,
    unit: h.company.unit,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind,
    reNo: h.scNo,
    meta: [h.bomCode, h.computedAt ? `Computed ${fmtDate(h.computedAt)}` : null].filter(Boolean).join(" · "),
  });
  const tw = drawThumbnail(doc, thumb, M, y);
  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: h.customer },
      { label: "Order No", value: h.orderNo },
      { label: "Style", value: h.styleRefNo, sub: h.styleName },
      {
        label: "Earlier Shipment",
        value: h.earlierShipmentDate ? fmtDate(h.earlierShipmentDate) : null,
        sub: h.deliveryFromDate ? `Delivery ${fmtDate(h.deliveryFromDate)}` : null,
      },
      { label: "Unit", value: ["PCS", h.company.unit].filter(Boolean).join(" · ") },
      { label: "Excess", value: h.excessPct == null ? null : `${fmtNumber(h.excessPct)}%` },
    ],
    { thumbWidth: tw ? tw - THUMB_GAP : 0 },
  );
  if (isReportRefusal(h.qty)) {
    doc.setFontSize(7);
    doc.setTextColor(150, 30, 30);
    doc.text(h.qty.refused, M, y + 8);
    doc.setTextColor(0);
    return y + 16;
  }
  const q = h.qty;
  const pct = (v: number | null) => (v == null ? null : `${v.toFixed(2)}%`);
  y = drawSheetLabel(doc, M, y + 6, "Quantity to cut");
  return drawQtyEquation(
    doc,
    y,
    [
      { label: "Order", value: fmtNumber(q.orderQty), note: "pcs" },
      { label: "Excess", value: fmtNumber(q.excessQty), note: h.excessPct == null ? null : `${fmtNumber(h.excessPct)}%` },
      { label: "Approval", value: fmtNumber(q.approvalQty), note: pct(q.approvalPct) },
      { label: "Rej. Allow", value: fmtNumber(q.rejectionQty), note: pct(q.rejectionPct) },
    ],
    { label: "Cut Qty", value: fmtNumber(q.cutQty), note: "pcs" },
  );
}

/**
 * THE LEGACY PRINTOUT, COLUMN FOR COLUMN — "Yarndyed _Format.pdf", the RP
 * system's own export, supplied by the client 2026-09-15 and rebuilt here
 * 2026-09-16 against a side-by-side comparison of the two documents.
 *
 * PORTRAIT, not the landscape this file's other export uses. That is not a
 * style choice: the legacy sheet is a portrait A4 an operator prints and signs
 * at the bottom, and the same document in landscape leaves the process
 * sections stranded in a page of white — the client's own complaint about the
 * Components/Widths sheets earlier the same month ("this much huge … still
 * blank space", AGENTS.md "A sub-detail Sheet's size").
 *
 * FIVE THINGS THE FIRST VERSION MISSED, all of them structure rather than
 * arithmetic:
 *
 *  1. The order facts were ONE RUN-ON LINE. Legacy sets them as a bordered
 *     grid — Customer / Delivery over RE No / Order
 *     No / Style Ref No / Style / Excess% / Unit and a five-column Quantity
 *     block — and the grid is what makes five numbers beside each other
 *     readable as a breakdown rather than a sentence.
 *  2. There was NO YARN DYEING SECTION at all; the yarn table stopped at the
 *     grey purchase rows. See `YarnDyeingLine` in ./reports.ts.
 *  3. The process ledgers had no `Dia/Size` and no `Nos/Mtrs` — so a flat-knit
 *     collar, which is ordered by the PIECE, had nowhere to show its count.
 *  4. The `Details` cell named the cloth but not its composition, and the
 *     `[YD Combo Name]` the knitting floor works to was nowhere on the page.
 *  5. No `Prepared By / Checked By / Approved By`. A document that is signed
 *     needs somewhere to sign it.
 */
export async function exportYarnRequirementPdf(
  data: YarnFabricRequirementReport,
  output: PdfOutput = "download",
  /** The header thumbnail's URL (2026-09-26) — null draws none. */
  thumbUrl: string | null = null,
): Promise<void> {
  const tab = openPrintTab(output);
  const [logo, thumb] = await Promise.all([loadLetterheadImage(data.header.company.logo), loadLetterheadImage(thumbUrl)]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const M = 28;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const h = data.header;

  /* THE SHEET FORMAT (user 2026-09-29) — masthead, order facts, quantity,
     then the figures purchasing came for and the order's route, before any
     detail. The tiles and the route are `sheet-summary.ts`'s, which the screen
     reads too. */
  let y = drawSheetHeader(doc, h, "Yarn & Fabric Requirement", logo, thumb);
  const tiles = requirementBuyTiles(data);
  if (tiles.length) {
    y = drawSheetLabel(doc, M, y + 2, "To buy for this order");
    y = drawSummaryTiles(
      doc,
      y,
      tiles.map((t) => ({ label: t.label, value: fmtNumber(Number(t.qty.toFixed(3))), unit: t.unit ?? undefined, note: t.note, tone: t.tone })),
    );
  }
  y = drawSheetLabel(doc, M, y + 2, "Route for this order");
  y = drawRouteStrip(doc, y, requirementRoute(data));

  // -- YARN REQUIREMENT ------------------------------------------------------
  y = roomFor(doc, y, 90);
  const yarnStartY = drawCardHeader(
    doc,
    M,
    y + 4,
    RIGHT - M,
    STAGE_STYLES.yarn,
    "Yarn Purchase Requirement",
    data.yarnGrandTotal ? `${fmtNumber(data.yarnGrandTotal.qty)}${data.yarnGrandTotal.uomCode ? ` ${data.yarnGrandTotal.uomCode}` : ""}` : null,
    data.yarnGrandTotal ? "Total to order" : null,
  );
  /* THE STAGE OF EACH ROW'S LABEL CELLS — the yarn dyeing rows are Dyed, a
     bought roll is Greige or Dyed (2026-09-20). Rows not here stay white. */
  const yarnRowTone = new Map<number, StageStyle>();

  /* A CELL IS A STRING OR A SPANNING BOX — `jspdf-autotable`'s own shape,
     narrowed to the parts this document uses. Declared once here because the
     two-row process header and the Quantity block both span. */
  type Cell =
    | string
    | { content: string; rowSpan?: number; colSpan?: number; styles?: Record<string, unknown> };
  const yarnBody: Cell[][] = [];
  const boldYarnRows = new Set<number>();

  const noteRows = new Set<number>();
  data.yarns.forEach((r, i) => {
    /* GREIGE ONLY when part of this yarn is bought dyed (2026-09-29) — the
       dyed colours are their own DYED YARN PURCHASE lines below. */
    const qty = r.greigeQty ?? r.purchaseQty;
    yarnBody.push([
      i === 0 ? "YARN PURCHASE" : "",
      r.stageState,
      r.yarnName,
      r.color ?? "",
      qty != null ? fmtNumber(qty) : "",
      "",
      qty != null ? fmtNumber(qty) : "",
    ]);
    /* A REFUSAL GETS ITS OWN FULL-WIDTH ROW, not the To Ordered Wt cell. It is
       a sentence, and a sentence in a figures column stretches that column to
       its length — which pushed Plan Wt and Loss % into slivers and made the
       whole yarn table look broken on the very document the operator opened
       BECAUSE something was wrong. */
    if (r.purchaseQty == null && r.refusalReason) {
      noteRows.add(yarnBody.length);
      yarnBody.push([{ content: r.refusalReason, colSpan: 7, styles: { textColor: [150, 30, 30] } }]);
    }
  });
  /* DYED YARN PURCHASE (client 2026-09-29) — bought already dyed, one line per
     colour, never merged into the greige lines. */
  data.yarns
    .flatMap((r) => (r.dyedPurchases ?? []).map((d) => ({ r, d })))
    .forEach(({ r, d }, i) => {
      yarnRowTone.set(yarnBody.length, STAGE_STYLES.dyed);
      yarnBody.push([
        i === 0 ? "DYED YARN PURCHASE" : "",
        "DYED",
        r.yarnName,
        d.colour,
        fmtNumber(d.plannedWt),
        d.lossPct != null ? d.lossPct.toFixed(2) : "",
        fmtNumber(d.toOrderedWt),
      ]);
    });
  if (data.yarns.length) {
    boldYarnRows.add(yarnBody.length);
    yarnBody.push([
      "",
      "",
      "",
      "Total :",
      /* A TOTAL ONLY WHERE THERE IS ONE. `yarnGrandTotal` is null when a yarn
         refused or two disagree on a unit — printing 0 there is the "buy
         nothing" reading ./reports.ts's own comment exists to stop. */
      data.yarnGrandTotal ? fmtNumber(data.yarnGrandTotal.qty) : "",
      "",
      data.yarnGrandTotal ? fmtNumber(data.yarnGrandTotal.qty) : "",
    ]);
  }
  /* CONVERSION — DIRECTLY UNDER YARN PURCHASE (client spec 2026-09-26), the
     same rows the screen draws: the converted yarn a colour needs, the
     unravelling loss, the loose fabric unravelled for it. `?? []` — a frozen
     V_final copy predates the field. */
  (data.conversion ?? []).forEach((l, i) => {
    yarnRowTone.set(yarnBody.length, STAGE_STYLES.dyed);
    yarnBody.push([
      i === 0 ? "CONVERSION" : "",
      "DYED",
      `${l.yarnName}\nfrom ${l.looseFabricName}`,
      l.colour ?? "",
      fmtNumber(l.plannedWt),
      l.lossPct != null ? l.lossPct.toFixed(2) : "",
      fmtNumber(l.toOrderedWt),
    ]);
  });
  data.yarnDyeing.forEach((l, i) => {
    yarnRowTone.set(yarnBody.length, STAGE_STYLES.dyed);
    yarnBody.push([
      i === 0 ? "YARN DYEING" : "",
      "DYED",
      l.yarnName,
      l.colorName,
      fmtNumber(l.plannedWt),
      l.lossPct ? l.lossPct.toFixed(2) : "",
      fmtNumber(l.toOrderedWt),
    ]);
  });
  if (data.yarnDyeingTotal) {
    boldYarnRows.add(yarnBody.length);
    yarnBody.push([
      "",
      "",
      "",
      "Total :",
      fmtNumber(data.yarnDyeingTotal.plannedWt),
      /* "Avg" when the colours carry different losses — see
         `sectionAverageLoss` for which average, and why not the spec's. */
      avgLossText(data.yarnDyeing, data.yarnDyeingTotal.plannedWt, data.yarnDyeingTotal.toOrderedWt),
      fmtNumber(data.yarnDyeingTotal.toOrderedWt),
    ]);
  }

  /* -- FABRIC PURCHASE (0564) -----------------------------------------------
     Default Rule 2's demand, IN THE SAME TABLE as the yarn it replaces rather
     than in a section of its own, because that is what it IS: for a cloth the
     factory does not knit, this line is the thing a purchase order is raised
     for, and putting it elsewhere would let a reader total the yarn table and
     believe they had the document's whole demand. The `Yarn` column carries
     the CLOTH's name and the `Type` column the source's own heading —
     legacy's grid has no column for a thing that did not exist, and inventing
     one would re-flow a printout this file matches column for column.

     It is LAST because it is downstream of nothing: a purchased roll has no
     yarn above it to read first. */
  data.clothPurchase.forEach((l, i) => {
    yarnRowTone.set(yarnBody.length, l.source === "dyed_purchase" ? STAGE_STYLES.dyed : STAGE_STYLES.greige);
    yarnBody.push([
      i === 0 ? "FABRIC PURCHASE" : "",
      l.source === "dyed_purchase" ? "DYED" : "GREIGE",
      l.fabricName,
      l.combo ?? "",
      fmtNumber(l.netWt),
      /* THE LOSS THE LADDER IMPLIES, never a second stored percentage — the
         same `(1 - net/gross) x 100` reading the YARN DYEING rows use, and 0
         where the route declares nothing after the roll lands, which is the
         true statement rather than a fabricated one. */
      l.purchaseWt > 0 ? (((l.purchaseWt - l.netWt) / l.purchaseWt) * 100).toFixed(2) : "",
      fmtNumber(l.purchaseWt),
    ]);
  });
  if (data.clothPurchaseTotal) {
    boldYarnRows.add(yarnBody.length);
    yarnBody.push([
      "",
      "",
      "",
      "Total :",
      "",
      "",
      fmtNumber(data.clothPurchaseTotal.qty),
    ]);
  }

  autoTable(doc, {
    head: [["Stage", "Type", "Yarn", "Color", "Plan Wt", "Loss %", "To Ordered Wt"]],
    body: yarnBody,
    startY: yarnStartY,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 34 },
      3: { cellWidth: 62 },
      4: { halign: "right", cellWidth: 62 },
      5: { halign: "right", cellWidth: 36 },
      6: { halign: "right", cellWidth: 76 },
    },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      /* STRIPED ROWS, the screen's odd/even (2026-09-29) — under the totals
         and tones below, which paint over it. */
      if (d.row.index % 2 === 1) d.cell.styles.fillColor = rgb(ROW_STRIPE);
      if (boldYarnRows.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = rgb(STAGE_STYLES.yarn.tint);
      }
      if (noteRows.has(d.row.index)) d.cell.styles.fontStyle = "italic";
      const tone = yarnRowTone.get(d.row.index);
      if (tone && d.column.index === 0) {
        d.cell.styles.fillColor = rgb(tone.tint);
        d.cell.styles.textColor = rgb(tone.ink);
      }
      /* THE STATE WORD BECOMES A BADGE (drawn in `didDrawCell`) — its text is
         cleared here so the plain word does not print under the badge. */
      if (d.column.index === 1 && STATE_BADGE[String(d.cell.raw ?? "")]) d.cell.text = [];
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 1) return;
      const word = String(d.cell.raw ?? "");
      if (STATE_BADGE[word]) drawStateBadge(doc, d.cell, word);
    },
  });
  y = finalY(doc, y);

  // -- one block per process -------------------------------------------------
  /* NO FABRIC PURCHASE SECTIONS (user 2026-09-26) — a bought cloth is the
     Fabric Purchase Requirement block already; the screen leaves them out too. */
  const ledger = data.stageBreakdown.filter((sec) => !sec.isClothPurchase);
  /* "PROCESS STAGE LEDGER" over the sections, as the screen heads them. */
  if (ledger.length) {
    y = roomFor(doc, y, 110);
    y = drawSheetLabel(doc, M, y + 18, "Process stage ledger");
  }
  for (const g of ledger) {
    /* THE SECTION WEARS ITS STAGE (2026-09-20) — Greige slate, Dyed blue,
       Wash teal, Print green; a process run in two stages names both. The
       bar carries the section's To Ordered total, as the screen's does. */
    const style = sectionStyle(g.stages, g.isPrint);
    y = roomFor(doc, y, 90);
    const startY = drawCardHeader(doc, M, y + 6, RIGHT - M, style, g.processName, fmtNumber(g.toOrderedTotal));

    /* THE `Nos/Mtrs` PAIR IS ON EVERY SECTION, even one whose cloths are all
       bought by weight — legacy's own shape, and the reason is the document
       rather than the section: sections of different widths in one printout
       read as a rendering fault, and the reader then distrusts the figures
       too. A cloth bought by weight leaves the cell BLANK, which is the true
       statement "not counted in pieces", and the Wt beside it is the answer. */

    /* DYEING / DYED FABRIC PURCHASE (client spec 2026-09-26): a Component
       column and a Piece Wt (g) column, one line per component. Other
       sections keep their columns. `pc` adds both cells to every row kind. */
    const pc = !!g.perComponent;
    /* A perComponent section bands and subtotals by the component's colour
       (2026-09-26); every other by the assort colourway. */
    const bandOf = (l: (typeof g.lines)[number]) => (pc ? (l.band ?? null) : l.combo);
    const body: Cell[][] = [];
    const boldRows = new Set<number>();
    /* ONE BAND PER ASSORT COLOURWAY (alternating) and a swatch of the cloth's
       own colour beside its name — row index → how to draw it. */
    const rowLook = new Map<number, { band: boolean; swatch: string | null }>();
    let colourRun = 0;
    g.lines.forEach((l, i) => {
      if (i > 0 && bandOf(g.lines[i - 1]) !== bandOf(l)) colourRun++;
      /* A SIZE RUN NAMES ITS CLOTH ONCE (2026-09-29) — on a per-size DYEING
         line the colour, fabric and component print on the run's first size
         only, as the Yarn table names "YARN PURCHASE" once. */
      const head = !sizeRunContinues(g.lines, i);
      rowLook.set(body.length, { band: colourRun % 2 === 1, swatch: head ? swatchFor(l.fabricColour) : null });
      body.push([
        head ? (l.fabricColour ?? "") : "",
        head ? detailsCell(l) : "",
        ...(pc ? [head ? (l.component ?? "") : ""] : []),
        diaSizeCell(l),
        ...(pc ? [l.pieces != null ? fmtNumber(l.pieces) : ""] : []),
        ...([l.plannedNos != null ? fmtNumber(l.plannedNos) : ""]),
        fmtNumber(l.plannedWt),
        ...(pc ? [l.pieceWtG != null ? fmtNumber(l.pieceWtG) : ""] : []),
        l.lossPct ? `${l.lossPct.toFixed(2)}%` : "",
        ...([l.toOrderedNos != null ? fmtNumber(l.toOrderedNos) : ""]),
        fmtNumber(l.toOrderedWt),
      ]);
      /* THE ASSORT COLOUR SUBTOTALS, unchanged — a row after each colour's
         run when the section holds more than one. The Colour COLUMN beside
         them is a different fact (the cloth's own colour / its YD Combo
         Name), which is why both are on the page. */
      const colourChanges = i === g.lines.length - 1 || bandOf(g.lines[i + 1]) !== bandOf(l);
      const sub = g.byColour.length > 1 && colourChanges ? g.byColour.find((c) => c.combo === bandOf(l)) : undefined;
      if (sub) {
        boldRows.add(body.length);
        body.push([
          "",
          `${sub.combo || "No colour"} — subtotal`,
          ...(pc ? [""] : []),
          "",
          ...(pc ? [""] : []),
          ...([""]),
          fmtNumber(sub.plannedTotal),
          ...(pc ? [""] : []),
          "",
          ...([""]),
          fmtNumber(sub.toOrderedTotal),
        ]);
      }
    });
    boldRows.add(body.length);
    body.push([
      "",
      "Grand Total :",
      ...(pc ? [""] : []),
      "",
      ...(pc ? [""] : []),
      ...([""]),
      fmtNumber(g.plannedTotal),
      ...(pc ? [""] : []),
      /* 0606 — a colour-wise step puts different losses in one section. */
      avgLossText(g.lines, g.plannedTotal, g.toOrderedTotal),
      ...([""]),
      fmtNumber(g.toOrderedTotal),
    ]);

    /* TWO HEADER ROWS — `Planned` and `To Ordered` each spanning their own
       `Nos/Mtrs` + `Wt` pair, which is what tells the reader the four figures
       are two pairs and not four columns. */
    const head: Cell[][] = [
      [
        { content: "Color", rowSpan: 2 },
        { content: "Details", rowSpan: 2 },
        ...(pc ? [{ content: "Component", rowSpan: 2 }] : []),
        { content: "Dia/Size", rowSpan: 2 },
        ...(pc ? [{ content: "Pcs", rowSpan: 2, styles: { halign: "right" as const } }] : []),
        { content: "Planned", colSpan: 2, styles: { halign: "center" } },
        ...(pc ? [{ content: "Piece Wt (g)", rowSpan: 2, styles: { halign: "right" as const } }] : []),
        { content: "Loss %", rowSpan: 2, styles: { halign: "right" } },
        { content: "To Ordered", colSpan: 2, styles: { halign: "center" } },
      ],
      [
        { content: "Nos/Mtrs", styles: { halign: "right" } },
        { content: "Wt", styles: { halign: "right" } },
        { content: "Nos/Mtrs", styles: { halign: "right" } },
        { content: "Wt", styles: { halign: "right" } },
      ],
    ];
    const grandRow = body.length - 1;
    autoTable(doc, {
      head,
      body,
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      theme: "plain",
      /* ONE LIST, INDEXED ONCE — the per-component section inserts three
         columns, so the widths are laid out in order rather than by fixed
         index. Portrait A4 at M 28 is 539pt wide: the per-component section's
         text columns are 58 + 96 + 64 + 48, Pcs 34, Piece Wt 38 and Loss 34
         (372), leaving ~42pt for each of the four figures ("1,234.567" at 7pt). */
      columnStyles: Object.fromEntries(
        [
          { cellWidth: pc ? 58 : 72 },
          { cellWidth: pc ? 96 : 178 },
          ...(pc ? [{ cellWidth: 64 }] : []),
          /* LEFT AND WIDER SINCE 0566 — a dia is text now ("23 CM", "25 BOX",
             "36 x 44"), and right-aligning a label ragged-lefts a column of
             mixed-length words. 40pt fitted "64" and clips a unit. */
          { halign: "left" as const, cellWidth: pc ? 48 : 56 },
          /* Pcs (2026-09-29) — the size's garments; its 34pt came off
             Color (-6) and Details (-14), so the four figures keep ~42pt. */
          ...(pc ? [{ halign: "right" as const, cellWidth: 34 }] : []),
          { halign: "right" as const },
          { halign: "right" as const },
          ...(pc ? [{ halign: "right" as const, cellWidth: 38 }] : []),
          { halign: "right" as const, cellWidth: 34 },
          { halign: "right" as const },
          { halign: "right" as const },
        ].map((st, i) => [i, st]),
      ),
      didParseCell: (d) => {
        if (d.section !== "body") return;
        if (boldRows.has(d.row.index)) d.cell.styles.fontStyle = "bold";
        if (d.row.index === grandRow) d.cell.styles.fillColor = rgb(style.tint);
        else if (boldRows.has(d.row.index)) d.cell.styles.fillColor = [226, 231, 236];
        const look = rowLook.get(d.row.index);
        if (look?.band) d.cell.styles.fillColor = rgb(COLOURWAY_BAND);
        if (look?.swatch && d.column.index === 0) d.cell.styles.cellPadding = SWATCH_PADDING;
      },
      didDrawCell: (d) => {
        if (d.section !== "body" || d.column.index !== 0) return;
        const hex = rowLook.get(d.row.index)?.swatch;
        if (hex) drawSwatch(doc, d.cell, hex);
      },
    });
    y = finalY(doc, y);
  }

  /* WEIGHTS THE LEDGER COULD NOT PLACE — printed, never dropped. */
  if (data.stageLedgerRefusals.length) {
    let ry = y + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    for (const r of data.stageLedgerRefusals) {
      doc.text(`! ${r}`, M, ry);
      ry += 10;
    }
    y = ry;
  }

  /* -- FABRIC ALLOCATION (CUTTING) — the report's last section (client
     2026-09-19, 3A). What reaches the cutting table per colourway, component
     set and dia: Net Cutting Wt before the cutting-room wastage, Allocated Wt
     with it. Rows are `fabricAllocationOf`'s — see ./fabric-allocation-report.ts.
     `Fabric` is carried beside the spec's five columns because one colourway's
     component sets are often cut from different cloths (a jersey body, a rib
     collar), and a row that does not say which reads as a total of both. */
  {
    const pageH = doc.internal.pageSize.getHeight();
    let startY = y + 22;
    /* A HEADING WITH NO ROOM FOR A ROW UNDER IT goes to the next page with its
       table, rather than standing alone at the foot of this one. */
    if (startY > pageH - 110) {
      doc.addPage();
      startY = 44;
    }
    startY = drawCardHeader(
      doc,
      M,
      startY - 12,
      RIGHT - M,
      STAGE_STYLES.cutting,
      "Fabric Allocation",
      isReportRefusal(data.allocation) ? null : fmtNumber(data.allocation.allocatedWt),
      isReportRefusal(data.allocation) ? null : "To the cutting table",
    );
    if (isReportRefusal(data.allocation)) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(`! ${data.allocation.refused}`, M, startY + 6);
      y = startY + 10;
    } else if (!data.allocation.rows.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("No cutting requirement on this BOM yet.", M, startY + 6);
      y = startY + 10;
    } else {
      const allocBody: string[][] = data.allocation.rows.map((r) => [
        r.component,
        r.combo || "All colours",
        r.fabricName,
        fmtNumber(r.netCuttingWt),
        [r.dia, r.gsm != null ? `${r.gsm} GSM` : null].filter(Boolean).join(" / "),
        fmtNumber(r.allocatedWt),
      ]);
      const totalRow = allocBody.length;
      /* Band per colourway run, swatch beside the colourway (2026-09-20). */
      const allocRows = data.allocation.rows;
      const allocBand = new Set<number>();
      let run = 0;
      allocRows.forEach((r, i) => {
        if (i > 0 && allocRows[i - 1].combo !== r.combo) run++;
        if (run % 2 === 1) allocBand.add(i);
      });
      allocBody.push([
        "",
        "",
        "Total :",
        fmtNumber(data.allocation.netCuttingWt),
        "",
        fmtNumber(data.allocation.allocatedWt),
      ]);
      autoTable(doc, {
        head: [["Component", "Garment Colourway", "Fabric", "Net Cutting Wt (Kg)", "Finished Dia / GSM", "Allocated Wt (Kg)"]],
        body: allocBody,
        startY,
        margin: { left: M, right: M, top: CONTINUED_TOP },
        styles: cardTableStyles(),
        headStyles: cardTableHead(),
        theme: "plain",
        columnStyles: {
          0: { cellWidth: 92 },
          1: { cellWidth: 70 },
          3: { halign: "right", cellWidth: 70 },
          4: { cellWidth: 72 },
          5: { halign: "right", cellWidth: 70 },
        },
        didParseCell: (d) => {
          if (d.section !== "body") return;
          if (d.row.index === totalRow) {
            d.cell.styles.fontStyle = "bold";
            d.cell.styles.fillColor = rgb(STAGE_STYLES.cutting.tint);
            return;
          }
          if (allocBand.has(d.row.index)) d.cell.styles.fillColor = rgb(COLOURWAY_BAND);
          if (d.column.index === 1 && swatchFor(allocRows[d.row.index]?.combo)) d.cell.styles.cellPadding = SWATCH_PADDING;
        },
        didDrawCell: (d) => {
          if (d.section !== "body" || d.column.index !== 1 || d.row.index === totalRow) return;
          const hex = swatchFor(allocRows[d.row.index]?.combo);
          if (hex) drawSwatch(doc, d.cell, hex);
        },
      });
      y = finalY(doc, y);
    }
  }

  signOffFooter(doc);
  pageFooter(doc, data.header);
  finishPdf(doc, `${stem("YarnFabricRequirement", data.header)}.pdf`, output, tab);
}


/**
 * The `Details` cell — legacy's own sentence, in its own order:
 *
 *   `YD SINGLE JERSEY (20'S COMBED COTTON GREEN 50% , … ) / Tubular 180 GSM`
 *   `[GHGFGF554JBHHBBBHH]`
 *
 * The parts arrive separately (see `StageBreakdownLine`) and are joined HERE
 * rather than in the report data, so the screen can set the YD combo name as
 * its own tagged line while the PDF sets it as a second text line.
 */
/** Is line `i` a further size of the same cloth and component as the line
 *  before it? Then it prints no colour / details / component of its own. */
export function sizeRunContinues(lines: readonly StageBreakdownLine[], i: number): boolean {
  if (i === 0 || !lines[i].sizeLabel) return false;
  const a = lines[i - 1];
  const b = lines[i];
  return (
    !!a.sizeLabel &&
    a.itemId === b.itemId &&
    a.combo === b.combo &&
    a.band === b.band &&
    a.component === b.component &&
    a.ydComboName === b.ydComboName
  );
}

/** `Dia/Size` — the dia, and on a per-size DYEING line the size after it
 *  ("30 / M"). The screen's `diaSizeText`, blank instead of a dash. */
function diaSizeCell(l: StageBreakdownLine): string {
  const dia = l.dia != null && String(l.dia).trim() ? String(l.dia) : null;
  return [dia, l.sizeLabel].filter(Boolean).join(" / ");
}

function detailsCell(l: StageBreakdownLine): string {
  /* A COMPOSITION THE NAME ALREADY STATES IS NOT REPEATED. This app's own
     fabric masters are NAMED for their blend — "SOLID CHAMBRAY (10'S COMBED
     COTTON) 100%" — where legacy's are not ("SOLID 1X1 LYCRA RIB"), so
     appending the mixing text unconditionally printed the same phrase twice in
     one cell. Compared with punctuation and spacing stripped, because the two
     are generated by different code and differ in exactly that: `(10'S COMBED
     COTTON 100% )` against `(10'S COMBED COTTON) 100%`.

     IT ONLY EVER DROPS A DUPLICATE. A yarn-dyed cloth's mixing text carries
     the COLOUR-WISE split (`GREEN 52.63% , RED 31.58% …`), which no name
     contains, so it survives this test — which is the case the client asked
     for by name. */
  const squash = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mixing = l.mixingText && !squash(l.fabricName).includes(squash(l.mixingText)) ? l.mixingText : null;
  const head = [l.fabricName, mixing].filter(Boolean).join(" ");
  const tail = [l.formLabel, l.gsm != null ? `${fmtNumber(l.gsm)} GSM` : null].filter(Boolean).join(" ");
  const first = tail ? `${head} / ${tail}` : head;
  return l.ydComboName ? `${first}\n[${l.ydComboName}]` : first;
}

/**
 * `Prepared By | Checked By | Approved By`, on the LAST page only.
 *
 * Three ruled lines above three labels, pinned to the bottom margin rather
 * than flowed after the last table — a sign-off that lands halfway up a page
 * because the content was short reads as part of the content.
 */
export function signOffFooter(doc: jsPDF): void {
  const M = 28;
  const W = doc.internal.pageSize.getWidth();
  const bottom = doc.internal.pageSize.getHeight() - 34;
  doc.setPage(doc.getNumberOfPages());
  const span = (W - M * 2) / 3;
  doc.setDrawColor(120);
  doc.setLineWidth(0.5);
  doc.line(M, bottom - 10, W - M, bottom - 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  ["Prepared By", "Checked By", "Approved By"].forEach((label, i) => {
    const x = i === 0 ? M : i === 1 ? M + span + span / 2 - 20 : W - M;
    doc.text(label, x, bottom, { align: i === 2 ? "right" : "left" });
  });
}

/** Where the table just drawn ended, or `fallback` when none was. */
export function finalY(doc: jsPDF, fallback: number): number {
  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return after?.finalY ?? fallback;
}

// ---------------------------------------------------------------------------
// Printing Requirement (client 2026-09-19)
// ---------------------------------------------------------------------------

/* ONE COLUMN SET for the PDF and the on-screen tab — "the exact weight sent
   for printing" is `Sent Wt`, the print step's INPUT.

   `Cut Pcs` / `Piece Wt (Kg)` (client 2026-09-19, decision 1A): the weight
   keeps the engine's backward walk, and these show what it rests on — the
   garments cut for this printed group and the cloth per garment before
   wastage. Never TOTALLED: a body fabric and a rib on one colourway count the
   same garments, so a sum would double them. */
const PRINT_COLUMNS = [
  "Assort Colour",
  "Fabric",
  "Component",
  "Print",
  "Process",
  "Dia/Size",
  "Cut Pcs",
  "Piece Wt (Kg)",
  "Wt Sent for Printing",
  "Loss %",
  "Wt After Printing",
];

function printRow(r: YarnFabricRequirementReport["printing"]["groups"][number]["rows"][number]): string[] {
  return [
    r.combo,
    r.fabricName,
    r.component,
    r.print,
    r.processName,
    r.dia,
    r.cutPieces == null ? "" : fmtNumber(r.cutPieces),
    r.pieceWt == null ? "" : r.pieceWt.toFixed(3),
    fmtNumber(r.sentWt),
    `${r.lossPct.toFixed(2)}%`,
    fmtNumber(r.receivedWt),
  ];
}

/**
 * THE DEDICATED PRINTING REQUIREMENT — what the printer is sent, per
 * colourway, and only for the colourways / components the order prints. The
 * isolation is the engine's (`routeForPrint`), not this renderer's: an
 * unprinted group never reaches a print section, so there is nothing here to
 * filter out.
 */
export async function exportPrintRequirementPdf(
  data: YarnFabricRequirementReport,
  output: PdfOutput = "download",
  /** The header thumbnail's URL (2026-09-26) — null draws none. */
  thumbUrl: string | null = null,
): Promise<void> {
  const tab = openPrintTab(output);
  const [logo, thumb] = await Promise.all([loadLetterheadImage(data.header.company.logo), loadLetterheadImage(thumbUrl)]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  /* THE SHEET FORMAT (user 2026-09-29) — the shared opening, what goes to the
     printer and comes back as tiles, then the table as a card. */
  const M = 28;
  let top = drawSheetHeader(doc, data.header, "Printing Requirement", logo, thumb);
  top = drawSheetLabel(doc, M, top + 2, "This sheet");
  top = drawSummaryTiles(
    doc,
    top,
    [
      { label: "Sent for printing", value: fmtNumber(data.printing.sentWt), unit: "kg", tone: STAGE_STYLES.print },
      { label: "Received back", value: fmtNumber(data.printing.receivedWt), unit: "kg", note: "after print loss", tone: STAGE_STYLES.print },
      { label: "Colourways", value: String(data.printing.groups.length), note: "printed", tone: STAGE_STYLES.print },
    ],
    M,
  );
  const y = drawCardHeader(
    doc,
    M,
    roomFor(doc, top, 90, 40) + 4,
    doc.internal.pageSize.getWidth() - M * 2,
    STAGE_STYLES.print,
    "Fabric Sent for Printing",
    fmtNumber(data.printing.sentWt),
    "Sent",
  );
  const body: string[][] = [];
  const bold = new Set<number>();
  /* Band per colourway group, swatch beside its name (2026-09-20). */
  const band = new Set<number>();
  const swatchAt = new Map<number, string>();
  data.printing.groups.forEach((g, gi) => {
    for (const r of g.rows) {
      if (gi % 2 === 1) band.add(body.length);
      const hex = swatchFor(r.combo);
      if (hex) swatchAt.set(body.length, hex);
      body.push(printRow(r));
    }
    if (data.printing.groups.length > 1) {
      bold.add(body.length);
      body.push([`${g.combo || "All colours"} total`, "", "", "", "", "", "", "", fmtNumber(g.sentWt), "", fmtNumber(g.receivedWt)]);
    }
  });
  bold.add(body.length);
  body.push(["TOTAL SENT FOR PRINTING", "", "", "", "", "", "", "", fmtNumber(data.printing.sentWt), "", fmtNumber(data.printing.receivedWt)]);
  autoTable(doc, {
    head: [PRINT_COLUMNS],
    body,
    startY: y,
    margin: { left: M, right: M },
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles: {
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      if (bold.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = rgb(STAGE_STYLES.print.tint);
        return;
      }
      if (band.has(d.row.index)) d.cell.styles.fillColor = rgb(COLOURWAY_BAND);
      if (d.column.index === 0 && swatchAt.has(d.row.index)) d.cell.styles.cellPadding = SWATCH_PADDING;
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 0) return;
      const hex = swatchAt.get(d.row.index);
      if (hex) drawSwatch(doc, d.cell, hex);
    },
  });
  signOffFooter(doc);
  pageFooter(doc, data.header);
  finishPdf(doc, `${stem("PrintingRequirement", data.header)}.pdf`, output, tab);
}

