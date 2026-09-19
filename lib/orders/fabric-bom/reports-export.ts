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
/* THE LETTERHEAD LOGO (2026-09-19) — loaded in the browser once per source and
   drawn into every PDF header below. A logo that fails to load prints nothing
   rather than stopping the download. */
import { fitLogo, loadLetterheadImage, type LetterheadImage } from "./letterhead";

function monoStyles() {
  return { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 };
}
function monoHead() {
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
function openPrintTab(output: PdfOutput): Window | null {
  return output === "print" && typeof window !== "undefined" ? window.open("", "_blank") : null;
}

/**
 * Save the PDF, or show it in the tab `openPrintTab` opened with the print
 * dialog raised (`autoPrint`). A print whose tab was blocked falls back to the
 * download — the operator still gets the document, just not the dialog.
 */
function finishPdf(doc: jsPDF, filename: string, output: PdfOutput, tab: Window | null): void {
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

/** The default facts line — every report except the Yarn & Fabric
 *  Requirement (which has its own exact five-field spec, see `YARN_FACTS`
 *  below). Widened for Report 1's SQ No; kept here rather than duplicated so
 *  that report's own header can still grow without a second copy to update. */
function defaultFacts(header: BomDocHeader): string[] {
  return [
    header.customer ? `Customer: ${header.customer}` : null,
    header.scNo ? `RE No: ${header.scNo}` : null,
    header.sqNo ? `SQ No: ${header.sqNo}` : null,
    header.orderNo ? `Order No: ${header.orderNo}` : null,
    header.styleRefNo ? `Style Ref No: ${header.styleRefNo}` : null,
    header.deliveryFromDate ? `Delivery: ${fmtDate(header.deliveryFromDate)}` : null,
  ].filter(Boolean) as string[];
}

/** The Yarn & Fabric Requirement Report's OWN header line (client spec,
 *  2026-09-11): Customer / RE No / Order No / Style Ref No / Delivery, in
 *  this order, and NOTHING ELSE — never `defaultFacts`, which now also
 *  carries Report 1's SQ No. Widening one shared facts line for one report's
 *  spec is exactly how the two came to need separating in the first place;
 *  see `YarnReportFactsRow`'s identical note on the on-screen Sheet. */
function yarnReportFacts(header: BomDocHeader): string[] {
  return [
    header.customer ? `Customer: ${header.customer}` : null,
    header.scNo ? `RE No: ${header.scNo}` : null,
    header.orderNo ? `Order No: ${header.orderNo}` : null,
    header.styleRefNo ? `Style Ref No: ${header.styleRefNo}` : null,
    header.deliveryFromDate ? `Delivery: ${fmtDate(header.deliveryFromDate)}` : null,
  ].filter(Boolean) as string[];
}

/** The letterhead + facts strip, drawn once per document and returned as the
 *  Y position the first table should start below. `facts` defaults to
 *  `defaultFacts`; pass `yarnReportFacts(header)` for the one report with its
 *  own exact spec. */
function drawLetterhead(
  doc: jsPDF,
  header: BomDocHeader,
  title: string,
  facts: string[] = defaultFacts(header),
  /** The company logo (2026-09-19) — see ./letterhead.ts. Null draws the
   *  text-only letterhead this function always drew. */
  logo: LetterheadImage | null = null,
): number {
  const M = 36;
  const RIGHT = doc.internal.pageSize.getWidth() - M;

  /* THE FRAME — a thin brand-green rule across the top, the same the on-screen
     letterhead carries, so the page and the printout read as one document. */
  doc.setFillColor(133, 194, 39);
  doc.rect(M, 20, RIGHT - M, 2.5, "F");

  /* THE LOGO, LEFT, fitted into 120 x 40 pt keeping its aspect ratio; the
     company's name and address sit beside it. */
  let textX = M;
  let logoBottom = 0;
  if (logo) {
    const { w, h } = fitLogo(logo, 120, 40);
    doc.addImage(logo.dataUrl, "PNG", M, 28, w, h);
    textX = M + w + 12;
    logoBottom = 28 + h;
  }

  let y = 44;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(header.company.name ?? "RAAGAM EXPORTS", textX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  /* THE UNIT, THEN THE REGISTERED ADDRESS (client spec 2026-09-19: Company
     Name, Unit Name, Registered Address on every exported report). The address
     WRAPS rather than running under the title on the right: it is typed on the
     Company Profile at whatever length the office uses. */
  if (header.company.unit) {
    doc.setFont("helvetica", "bold");
    doc.text(header.company.unit.toUpperCase(), textX, (y += 12));
    doc.setFont("helvetica", "normal");
  }
  if (header.company.address) {
    const lines = doc.splitTextToSize(header.company.address, Math.max(160, RIGHT - textX - 220)) as string[];
    for (const line of lines.slice(0, 3)) doc.text(line, textX, (y += 10));
  }
  if (header.company.gstin) doc.text(`GSTIN ${header.company.gstin}`, textX, (y += 10));

  doc.setTextColor(3, 123, 184);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), RIGHT, 44, { align: "right" });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (header.bomCode) doc.text(header.bomCode, RIGHT, 56, { align: "right" });

  /* A DARK RULE UNDER THE LETTERHEAD, below whichever is taller — the text
     block or the logo. */
  y = Math.max(y, logoBottom) + 8;
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1);
  doc.line(M, y, RIGHT, y);
  doc.setLineWidth(0.4);

  y += 14;
  doc.setFontSize(9);
  if (facts.length) doc.text(facts.join("    "), M, y);

  if (!isReportRefusal(header.qty)) {
    y += 12;
    doc.setFontSize(8);
    doc.setTextColor(70);
    doc.text(
      `Order Qty ${fmtNumber(header.qty.orderQty)}    Excess Qty ${fmtNumber(header.qty.excessQty)}` +
        `    Rejection Allowance ${fmtNumber(header.qty.rejectionQty)}    Approval Allowance ${fmtNumber(header.qty.approvalQty)}` +
        `    Cut Qty ${fmtNumber(header.qty.sqQty)}`,
      M,
      y,
    );
    doc.setTextColor(0);
  }

  return y + 10;
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
function pageFooter(doc: jsPDF, header: BomDocHeader, opts?: { pageNumbers?: boolean }): void {
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

function registerBody(data: EntryRegister): { body: string[][]; totalAt: number[] } {
  const body: string[][] = [];
  const totalAt: number[] = [];
  for (const cg of data.groups) {
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
          fmtNumber(sz.sqQty),
          sz.pieceWt != null ? fmtNumber(sz.pieceWt) : "",
          sz.wastagePct != null ? `${sz.wastagePct}%` : "",
          fmtNumber(sz.netReqWt),
          sz.lossPct != null ? `${sz.lossPct.toFixed(2)}%` : "",
          fmtNumber(sz.grossWt),
          sz.uomCode ?? "",
        ]);
      }
      totalAt.push(body.length);
      body.push([
        "",
        `${componentLabel || comp.fabricName} — subtotal`,
        "",
        "",
        "",
        "",
        "",
        "",
        fmtNumber(comp.subtotal.sqQty),
        "",
        "",
        fmtNumber(comp.subtotal.netReqWt),
        "",
        fmtNumber(comp.subtotal.grossWt),
        "",
      ]);
    }
    totalAt.push(body.length);
    body.push([
      `${cg.combo || "(no colour)"} — subtotal`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      fmtNumber(cg.subtotal.sqQty),
      "",
      "",
      fmtNumber(cg.subtotal.netReqWt),
      "",
      fmtNumber(cg.subtotal.grossWt),
      "",
    ]);
  }
  totalAt.push(body.length);
  body.push([
    "GRAND TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fmtNumber(data.grandTotal.sqQty),
    "",
    "",
    fmtNumber(data.grandTotal.netReqWt),
    "",
    fmtNumber(data.grandTotal.grossWt),
    "",
  ]);
  return { body, totalAt };
}

export async function exportEntryRegisterPdf(data: EntryRegister, output: PdfOutput = "download"): Promise<void> {
  const tab = openPrintTab(output);
  const logo = await loadLetterheadImage(data.header.company.logo);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const y = drawLetterhead(doc, data.header, "Fabric BOM Entry Register", undefined, logo);

  const { body, totalAt } = registerBody(data);
  const bold = new Set(totalAt);

  autoTable(doc, {
    head: [REGISTER_COLUMNS],
    body,
    startY: y,
    margin: { left: M, right: M },
    styles: monoStyles(),
    headStyles: monoHead(),
    alternateRowStyles: { fillColor: [250, 250, 251] },
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
      if (d.section === "body" && bold.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [255, 255, 255];
      }
    },
  });

  if (data.stageLedger.length) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    const startY = (after?.finalY ?? y) + 24;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("PROCESS SEQUENCE & STAGE LOSS LEDGER", M, startY - 8);
    autoTable(doc, {
      head: [["Class", "Item", "Colour", "Component", "Stage", "Process", "Loss %"]],
      body: data.stageLedger.map((r) => [
        r.className,
        r.itemName,
        r.combo ?? "",
        r.componentName ?? "",
        r.stageName ?? "",
        r.processName ?? "",
        r.lossPct != null ? `${r.lossPct.toFixed(2)}%` : "",
      ]),
      startY,
      margin: { left: M, right: M },
      styles: monoStyles(),
      headStyles: monoHead(),
      columnStyles: { 6: { halign: "right" } },
    });
  }

  pageFooter(doc, data.header);
  finishPdf(doc, `${stem("FabricBomEntryRegister", data.header)}.pdf`, output, tab);
}

// ---------------------------------------------------------------------------
// Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------

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
 *     grid — SQ No / SQ Description / Customer / Delivery over RE No / Order
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
export async function exportYarnRequirementPdf(data: YarnFabricRequirementReport, output: PdfOutput = "download"): Promise<void> {
  const tab = openPrintTab(output);
  const logo = await loadLetterheadImage(data.header.company.logo);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const M = 28;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const MID = doc.internal.pageSize.getWidth() / 2;
  const h = data.header;

  /* THE LEGACY LAYOUT KEEPS ITS CENTRED TITLE; the logo (2026-09-19) sits at
     the top LEFT, fitted to 96 x 32 pt, clear of the centred lines and above
     the "Report Printed" line at y = 62. A thin brand-green rule runs across
     the top, the same frame the other Fabric BOM documents carry. */
  doc.setFillColor(133, 194, 39);
  doc.rect(M, 12, RIGHT - M, 2, "F");
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 96, 32);
    doc.addImage(logo.dataUrl, "PNG", M, 20, w, lh);
  }

  /* THE PRINT TIME IS THE READER'S OWN CLOCK, taken here rather than on the
     server. `header.computedAt` is a different fact and is already printed by
     the page footer: when the FIGURES were computed, which can be days before
     someone prints them. Legacy's line says "Report Printed Date & Time", and
     a server-side stamp would render it in UTC on a UTC+5:30 business — the
     mistake `lib/dashboard/range.ts` records for `today()`. */
  const printedAt = new Date();
  const printed =
    `${String(printedAt.getDate()).padStart(2, "0")}-${String(printedAt.getMonth() + 1).padStart(2, "0")}-` +
    `${printedAt.getFullYear()} ${printedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(h.company.name ?? "RAAGAM EXPORTS", MID, 32, { align: "center" });

  /* THE UNIT AND THE REGISTERED ADDRESS, centred under the name (client spec
     2026-09-19: Company Name, Unit Name, Registered Address on every exported
     report — this header printed the name alone). The address wraps inside the
     band the logo leaves clear (96 pt each side plus a gap), so it never runs
     under the logo, and everything below moves down by however many lines it
     took — a blank address costs no space at all. */
  let headY = 32;
  doc.setFontSize(7.5);
  if (h.company.unit) doc.text(h.company.unit.toUpperCase(), MID, (headY += 9), { align: "center" });
  doc.setFont("helvetica", "normal");
  if (h.company.address) {
    const band = RIGHT - M - 2 * (96 + 12);
    const lines = doc.splitTextToSize(h.company.address, band) as string[];
    for (const line of lines.slice(0, 2)) doc.text(line, MID, (headY += 8.5), { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const titleY = Math.max(48, headY + 13);
  doc.text("YARN AND FABRIC REQUIREMENT", MID, titleY, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const printedY = titleY + 14;
  doc.text(`Report Printed Date & Time: ${printed}`, M, printedY);
  /* `Page : 1/1` SITS AT THE TOP RIGHT, where legacy puts it, as well as in
     the page footer. Written after every table has been laid out (the total
     is not known until then) — see the `stampTopPageNumbers` call at the
     foot of this function. */

  let y = printedY + 8;

  // -- the order facts, as a grid --------------------------------------------
  const fact = (label: string, value: string | null | undefined) => ({
    content: `${label} ${value ?? ""}`.trim(),
    styles: { fontStyle: "normal" as const },
  });
  autoTable(doc, {
    body: [
      [
        fact("SQ No.:", h.sqNo),
        fact("SQ Description:", h.sqDescription),
        fact("Customer:", h.customer),
        fact(
          "Delivery From:",
          h.deliveryFromDate
            ? `${fmtDate(h.deliveryFromDate)}  To: ${fmtDate(h.deliveryToDate ?? h.deliveryFromDate)}`
            : "",
        ),
      ],
    ],
    startY: y,
    margin: { left: M, right: M },
    styles: { ...monoStyles(), fontSize: 7 },
    theme: "grid",
  });
  y = finalY(doc, y);

  /* THE QUANTITY BLOCK — five columns under one spanning header, which is
     what makes Order + Excess + Approval + Rej.Allow = SQ read as a sum. The
     two allowance columns carry their own percentage of the order qty
     (`approvalPct` / `rejectionPct`, derived once in ./reports.ts). */
  const q = isReportRefusal(h.qty) ? null : h.qty;
  const withPct = (qty: number, pct: number | null) =>
    pct == null ? fmtNumber(qty) : `${fmtNumber(qty)} (${pct.toFixed(2)}%)`;
  autoTable(doc, {
    head: [
      [
        { content: "RE No.", rowSpan: 2 },
        { content: "Order No.", rowSpan: 2 },
        { content: "Style Ref No", rowSpan: 2 },
        { content: "Style", rowSpan: 2 },
        { content: "Excess%", rowSpan: 2 },
        { content: "Unit", rowSpan: 2 },
        { content: "Quantity", colSpan: 5, styles: { halign: "center" as const } },
      ],
      [
        { content: "Order", styles: { halign: "right" as const } },
        { content: "Excess", styles: { halign: "right" as const } },
        { content: "Approval", styles: { halign: "right" as const } },
        { content: "Rej.Allow", styles: { halign: "right" as const } },
        { content: "Cut", styles: { halign: "right" as const } },
      ],
    ],
    body: [
      [
        h.scNo ?? "",
        h.orderNo ?? "",
        h.styleRefNo ?? "",
        h.styleName ?? "",
        h.excessPct == null ? "" : `${h.excessPct}`,
        /* PCS, AND IT IS NOT A GUESS — every quantity in this block is a
           GARMENT count (`OrderProductionInput`'s approval rows are pieces),
           which is the one unit this document's header can state without
           reading a column that does not exist. */
        q ? "PCS" : "",
        q ? fmtNumber(q.orderQty) : "",
        q ? fmtNumber(q.excessQty) : "",
        q ? withPct(q.approvalQty, q.approvalPct) : "",
        q ? withPct(q.rejectionQty, q.rejectionPct) : "",
        q ? fmtNumber(q.sqQty) : "",
      ],
    ],
    startY: y + 4,
    margin: { left: M, right: M },
    styles: { ...monoStyles(), fontSize: 7 },
    headStyles: { ...monoHead(), fontSize: 6.5 },
    theme: "grid",
    columnStyles: {
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
  });
  y = finalY(doc, y);

  /* THE REFUSAL, WHERE THE BREAKDOWN WOULD HAVE BEEN. `productionTarget`
     refuses by name (no Approval Qty yet, a rejection tier with a gap) and
     that sentence is the document's answer, not an empty row of dashes. */
  if (isReportRefusal(h.qty)) {
    doc.setFontSize(7);
    doc.setTextColor(150, 30, 30);
    doc.text(h.qty.refused, M, y + 10);
    doc.setTextColor(0);
    y += 14;
  }

  // -- YARN REQUIREMENT ------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("YARN REQUIREMENT", M, y + 14);

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
    yarnBody.push([
      i === 0 ? "YARN PURCHASE" : "",
      r.stageState,
      r.yarnName,
      r.color ?? "",
      r.purchaseQty != null ? fmtNumber(r.purchaseQty) : "",
      "",
      r.purchaseQty != null ? fmtNumber(r.purchaseQty) : "",
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
  data.yarnDyeing.forEach((l, i) => {
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
      "",
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
    startY: y + 18,
    margin: { left: M, right: M },
    styles: { ...monoStyles(), fontSize: 7 },
    headStyles: { ...monoHead(), fontSize: 6.5 },
    theme: "grid",
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 34 },
      3: { cellWidth: 62 },
      4: { halign: "right", cellWidth: 62 },
      5: { halign: "right", cellWidth: 36 },
      6: { halign: "right", cellWidth: 76 },
    },
    didParseCell: (d) => {
      if (d.section === "body" && boldYarnRows.has(d.row.index)) d.cell.styles.fontStyle = "bold";
      if (d.section === "body" && noteRows.has(d.row.index)) d.cell.styles.fontStyle = "italic";
    },
  });
  y = finalY(doc, y);

  // -- one block per process -------------------------------------------------
  for (const g of data.stageBreakdown) {
    const startY = y + 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(g.processName.toUpperCase(), M, startY - 6);

    /* THE `Nos/Mtrs` PAIR IS ON EVERY SECTION, even one whose cloths are all
       bought by weight — legacy's own shape, and the reason is the document
       rather than the section: sections of different widths in one printout
       read as a rendering fault, and the reader then distrusts the figures
       too. A cloth bought by weight leaves the cell BLANK, which is the true
       statement "not counted in pieces", and the Wt beside it is the answer. */

    const body: Cell[][] = [];
    const boldRows = new Set<number>();
    g.lines.forEach((l, i) => {
      body.push([
        l.fabricColour ?? "",
        detailsCell(l),
        l.dia ?? "",
        ...([l.plannedNos != null ? fmtNumber(l.plannedNos) : ""]),
        fmtNumber(l.plannedWt),
        l.lossPct ? `${l.lossPct.toFixed(2)}%` : "",
        ...([l.toOrderedNos != null ? fmtNumber(l.toOrderedNos) : ""]),
        fmtNumber(l.toOrderedWt),
      ]);
      /* THE ASSORT COLOUR SUBTOTALS, unchanged — a row after each colour's
         run when the section holds more than one. The Colour COLUMN beside
         them is a different fact (the cloth's own colour / its YD Combo
         Name), which is why both are on the page. */
      const colourChanges = i === g.lines.length - 1 || g.lines[i + 1].combo !== l.combo;
      const sub = g.byColour.length > 1 && colourChanges ? g.byColour.find((c) => c.combo === l.combo) : undefined;
      if (sub) {
        boldRows.add(body.length);
        body.push([
          "",
          `${sub.combo || "No colour"} — subtotal`,
          "",
          ...([""]),
          fmtNumber(sub.plannedTotal),
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
      "",
      ...([""]),
      fmtNumber(g.plannedTotal),
      "",
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
        { content: "Dia/Size", rowSpan: 2 },
        { content: "Planned", colSpan: 2, styles: { halign: "center" } },
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
    autoTable(doc, {
      head,
      body,
      startY,
      margin: { left: M, right: M },
      styles: { ...monoStyles(), fontSize: 7 },
      headStyles: { ...monoHead(), fontSize: 6.5 },
      theme: "grid",
      columnStyles: {
        0: { cellWidth: 72 },
        1: { cellWidth: 178 },
        /* LEFT AND WIDER SINCE 0566 — a dia is text now ("23 CM", "25 BOX",
           "36 x 44"), and right-aligning a label ragged-lefts a column of
           mixed-length words. 40pt fitted "64" and clips a unit. */
        2: { halign: "left", cellWidth: 56 },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right", cellWidth: 34 },
        6: { halign: "right" },
        7: { halign: "right" },
      },
      didParseCell: (d) => {
        if (d.section === "body" && boldRows.has(d.row.index)) d.cell.styles.fontStyle = "bold";
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
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("FABRIC ALLOCATION (CUTTING)", M, startY - 6);
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
        margin: { left: M, right: M },
        styles: { ...monoStyles(), fontSize: 7 },
        headStyles: { ...monoHead(), fontSize: 6.5 },
        theme: "grid",
        columnStyles: {
          0: { cellWidth: 92 },
          1: { cellWidth: 70 },
          3: { halign: "right", cellWidth: 70 },
          4: { cellWidth: 72 },
          5: { halign: "right", cellWidth: 70 },
        },
        didParseCell: (d) => {
          if (d.section === "body" && d.row.index === totalRow) d.cell.styles.fontStyle = "bold";
        },
      });
      y = finalY(doc, y);
    }
  }

  signOffFooter(doc);
  stampTopPageNumbers(doc, printedY);
  pageFooter(doc, data.header, { pageNumbers: false });
  finishPdf(doc, `${stem("YarnFabricRequirement", data.header)}.pdf`, output, tab);
}

/** `Page : 1/1` at the top right of every page — legacy's own placement,
 *  beside the printed-at line. Written last because the page COUNT is not
 *  known until every table has been laid out. */
/* `firstPageY` keeps page 1's stamp level with its "Report Printed" line,
   which moves down when the unit and registered address print above it;
   later pages keep the fixed position they always had. */
function stampTopPageNumbers(doc: jsPDF, firstPageY = 62): void {
  const M = 28;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(0);
    doc.text(`Page : ${p}/${pages}`, RIGHT, p === 1 ? firstPageY : 62, { align: "right" });
  }
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
function signOffFooter(doc: jsPDF): void {
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
function finalY(doc: jsPDF, fallback: number): number {
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
export async function exportPrintRequirementPdf(data: YarnFabricRequirementReport, output: PdfOutput = "download"): Promise<void> {
  const tab = openPrintTab(output);
  const logo = await loadLetterheadImage(data.header.company.logo);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const y = drawLetterhead(doc, data.header, "Printing Requirement", yarnReportFacts(data.header), logo);
  const body: string[][] = [];
  const bold = new Set<number>();
  for (const g of data.printing.groups) {
    for (const r of g.rows) body.push(printRow(r));
    if (data.printing.groups.length > 1) {
      bold.add(body.length);
      body.push([`${g.combo || "All colours"} total`, "", "", "", "", "", "", "", fmtNumber(g.sentWt), "", fmtNumber(g.receivedWt)]);
    }
  }
  bold.add(body.length);
  body.push(["TOTAL SENT FOR PRINTING", "", "", "", "", "", "", "", fmtNumber(data.printing.sentWt), "", fmtNumber(data.printing.receivedWt)]);
  autoTable(doc, {
    head: [PRINT_COLUMNS],
    body,
    startY: y,
    margin: { left: M, right: M },
    styles: monoStyles(),
    headStyles: monoHead(),
    columnStyles: {
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
    didParseCell: (d) => {
      if (d.section === "body" && bold.has(d.row.index)) d.cell.styles.fontStyle = "bold";
    },
  });
  signOffFooter(doc);
  pageFooter(doc, data.header);
  finishPdf(doc, `${stem("PrintingRequirement", data.header)}.pdf`, output, tab);
}

