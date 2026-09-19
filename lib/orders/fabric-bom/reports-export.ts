/**
 * Downloading the two Fabric BOM reports — PDF and Excel (CSV, same as
 * `lib/orders/fabric-requirement/export.ts`'s own "Excel" button; a `.xlsx`
 * library was never introduced there and this file doesn't introduce one
 * either, on purpose — one convention for "download to Excel" across the app).
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

function monoStyles() {
  return { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 };
}
function monoHead() {
  return { fillColor: [235, 237, 240] as [number, number, number], textColor: 20, fontStyle: "bold" as const };
}

function stem(prefix: string, header: BomDocHeader): string {
  const key = (header.scNo || header.bomCode || "bom")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}_${key}`;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function download(filename: string, text: string, mime: string): void {
  // The BOM prefix keeps Excel from reading a leading `=`/`+` as a formula —
  // the same guard `exportFabricRequirementCsv` uses.
  const blob = new Blob(["﻿" + text], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The default facts line — every report except the Yarn & Fabric
 *  Requirement (which has its own exact five-field spec, see `YARN_FACTS`
 *  below). Widened for Report 1's SQ No; kept here rather than duplicated so
 *  that report's own header can still grow without a second copy to update. */
function defaultFacts(header: BomDocHeader): string[] {
  return [
    header.customer ? `Customer: ${header.customer}` : null,
    header.scNo ? `SC No: ${header.scNo}` : null,
    header.sqNo ? `SQ No: ${header.sqNo}` : null,
    header.orderNo ? `Order No: ${header.orderNo}` : null,
    header.styleRefNo ? `Style Ref No: ${header.styleRefNo}` : null,
    header.deliveryFromDate ? `Delivery: ${fmtDate(header.deliveryFromDate)}` : null,
  ].filter(Boolean) as string[];
}

/** The Yarn & Fabric Requirement Report's OWN header line (client spec,
 *  2026-09-11): Customer / SC No / Order No / Style Ref No / Delivery, in
 *  this order, and NOTHING ELSE — never `defaultFacts`, which now also
 *  carries Report 1's SQ No. Widening one shared facts line for one report's
 *  spec is exactly how the two came to need separating in the first place;
 *  see `YarnReportFactsRow`'s identical note on the on-screen Sheet. */
function yarnReportFacts(header: BomDocHeader): string[] {
  return [
    header.customer ? `Customer: ${header.customer}` : null,
    header.scNo ? `SC No: ${header.scNo}` : null,
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
): number {
  const M = 36;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(header.company.name ?? "RAAGAM EXPORTS", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  if (header.company.address) doc.text(header.company.address, M, (y += 12));
  if (header.company.gstin) doc.text(`GSTIN ${header.company.gstin}`, M, (y += 10));

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), RIGHT, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (header.bomCode) doc.text(header.bomCode, RIGHT, 58, { align: "right" });

  y += 18;
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

export function exportEntryRegisterPdf(data: EntryRegister): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const y = drawLetterhead(doc, data.header, "Fabric BOM Entry Register");

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
  doc.save(`${stem("FabricBomEntryRegister", data.header)}.pdf`);
}

export function exportEntryRegisterCsv(data: EntryRegister): void {
  const rows: string[][] = [REGISTER_COLUMNS];
  // A total row is dropped here, same reason `fabricRequirementCsv` drops one:
  // a spreadsheet sums its own column, and a stored total among the rows would
  // be double-counted by anyone who does.
  for (const cg of data.groups) {
    for (const comp of cg.components) {
      const componentLabel = comp.componentNames.join(", ");
      for (const sz of comp.sizes) {
        rows.push([
          cg.combo ?? "",
          componentLabel,
          comp.fabricName,
          comp.itemForm ?? "",
          comp.gsm != null ? String(comp.gsm) : "",
          sz.sizeLabel,
          sz.dia ?? "",
          sz.purchaseWidth != null ? String(sz.purchaseWidth) : "",
          String(sz.sqQty),
          sz.pieceWt != null ? String(sz.pieceWt) : "",
          sz.wastagePct != null ? String(sz.wastagePct) : "",
          String(sz.netReqWt),
          sz.lossPct != null ? String(sz.lossPct) : "",
          String(sz.grossWt),
          sz.uomCode ?? "",
        ]);
      }
    }
  }
  download(`${stem("FabricBomEntryRegister", data.header)}.csv`, toCsv(rows), "text/csv");
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
 *     grid — SQ No / SQ Description / Customer / Delivery over SC No / Order
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
export function exportYarnRequirementPdf(data: YarnFabricRequirementReport): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const M = 28;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const MID = doc.internal.pageSize.getWidth() / 2;
  const h = data.header;

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
  doc.text(h.company.name ?? "RAAGAM EXPORTS", MID, 34, { align: "center" });
  doc.setFontSize(10);
  doc.text("YARN AND FABRIC REQUIREMENT", MID, 48, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Report Printed Date & Time: ${printed}`, M, 62);
  /* `Page : 1/1` SITS AT THE TOP RIGHT, where legacy puts it, as well as in
     the page footer. Written after every table has been laid out (the total
     is not known until then) — see the `stampTopPageNumbers` call at the
     foot of this function. */

  let y = 70;

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
        { content: "SC No.", rowSpan: 2 },
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

  signOffFooter(doc);
  stampTopPageNumbers(doc);
  pageFooter(doc, data.header, { pageNumbers: false });
  doc.save(`${stem("YarnFabricRequirement", data.header)}.pdf`);
}

/** `Page : 1/1` at the top right of every page — legacy's own placement,
 *  beside the printed-at line. Written last because the page COUNT is not
 *  known until every table has been laid out. */
function stampTopPageNumbers(doc: jsPDF): void {
  const M = 28;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(0);
    doc.text(`Page : ${p}/${pages}`, RIGHT, 62, { align: "right" });
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

export function exportYarnRequirementCsv(data: YarnFabricRequirementReport): void {
  /* ONE ROW SHAPE FOR EVERY SECTION, which is what makes the file sortable and
     pivotable — a spreadsheet cannot filter three tables stacked in one sheet.
     The columns the PDF splits into `Planned`/`To Ordered` pairs are flat here
     for the same reason. */
  const rows: string[][] = [
    [
      "Section",
      "Stage",
      "Type",
      "Yarn / Fabric",
      "Color",
      "Component",
      "Dia/Size",
      "Planned Nos/Mtrs",
      "Planned Wt",
      "Loss %",
      "To Ordered Nos/Mtrs",
      "To Ordered Wt",
      "Count Unit",
      "Unit",
      "Note",
    ],
  ];
  for (const y of data.yarns) {
    rows.push([
      "Yarn Purchase",
      y.stageState,
      y.itemType,
      y.yarnName,
      y.color ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      y.purchaseQty != null ? String(y.purchaseQty) : "",
      "",
      y.uomCode ?? "",
      y.refusalReason ?? "",
    ]);
  }
  if (data.yarnGrandTotal) {
    rows.push([
      "Yarn Purchase",
      "",
      "",
      "TOTAL YARN PURCHASE REQUIREMENT",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      String(data.yarnGrandTotal.qty),
      "",
      data.yarnGrandTotal.uomCode ?? "",
      "",
    ]);
  }
  /* THE YARN DYEING BLOCK — one row per (yarn, colourway, colour), same rows
     the PDF prints. Its Planned and To Ordered are real figures, so they go in
     the same two columns every other section uses rather than columns of
     their own. */
  for (const l of data.yarnDyeing) {
    rows.push([
      "Yarn Dyeing",
      "DYED",
      "YARN",
      l.yarnName,
      l.colorName,
      "",
      "",
      "",
      String(l.plannedWt),
      String(l.lossPct),
      "",
      String(l.toOrderedWt),
      "",
      l.uomCode ?? "",
      "",
    ]);
  }
  for (const g of data.stageBreakdown) {
    for (const l of g.lines) {
      rows.push([
        g.processName,
        "",
        "",
        /* THE DETAILS CELL'S OWN SENTENCE, so a row read out of the spreadsheet
           says which cloth, in which composition, at which form and GSM —
           the same string the PDF prints. */
        detailsCell(l).replace(/\n/g, " "),
        /* THE CLOTH'S COLOUR, then the assort colourway it belongs to — the
           PDF shows the first as a column and the second as a band, and a
           flat file has to carry both or a filtered row loses its colourway. */
        [l.fabricColour, l.combo].filter(Boolean).join(" · "),
        l.component ?? "",
        l.dia ?? "",
        l.plannedNos != null ? String(l.plannedNos) : "",
        String(l.plannedWt),
        String(l.lossPct),
        l.toOrderedNos != null ? String(l.toOrderedNos) : "",
        String(l.toOrderedWt),
        l.nosUomCode ?? "",
        "",
        "",
      ]);
    }
  }
  for (const r of data.stageLedgerRefusals) {
    rows.push(["Process Stage Ledger", "", "", "", "", "", "", "", "", "", "", "", "", "", r]);
  }
  download(`${stem("YarnFabricRequirement", data.header)}.csv`, toCsv(rows), "text/csv");
}

// ---------------------------------------------------------------------------
// Printing Requirement (client 2026-09-19)
// ---------------------------------------------------------------------------

/* ONE COLUMN SET for the PDF, the CSV and the on-screen tab — "the exact
   weight sent for printing" is `Sent Wt`, the print step's INPUT. */
const PRINT_COLUMNS = [
  "Assort Colour",
  "Fabric",
  "Component",
  "Print",
  "Process",
  "Dia/Size",
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
export function exportPrintRequirementPdf(data: YarnFabricRequirementReport): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const y = drawLetterhead(doc, data.header, "Printing Requirement", yarnReportFacts(data.header));
  const body: string[][] = [];
  const bold = new Set<number>();
  for (const g of data.printing.groups) {
    for (const r of g.rows) body.push(printRow(r));
    if (data.printing.groups.length > 1) {
      bold.add(body.length);
      body.push([`${g.combo || "All colours"} total`, "", "", "", "", "", fmtNumber(g.sentWt), "", fmtNumber(g.receivedWt)]);
    }
  }
  bold.add(body.length);
  body.push(["TOTAL SENT FOR PRINTING", "", "", "", "", "", fmtNumber(data.printing.sentWt), "", fmtNumber(data.printing.receivedWt)]);
  autoTable(doc, {
    head: [PRINT_COLUMNS],
    body,
    startY: y,
    margin: { left: M, right: M },
    styles: monoStyles(),
    headStyles: monoHead(),
    columnStyles: { 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && bold.has(d.row.index)) d.cell.styles.fontStyle = "bold";
    },
  });
  signOffFooter(doc);
  pageFooter(doc, data.header);
  doc.save(`${stem("PrintingRequirement", data.header)}.pdf`);
}

export function exportPrintRequirementCsv(data: YarnFabricRequirementReport): void {
  /* No total rows — a spreadsheet sums its own column (the Entry Register's
     reason, above). */
  const rows: string[][] = [PRINT_COLUMNS];
  for (const g of data.printing.groups) {
    for (const r of g.rows) {
      rows.push([
        r.combo,
        r.fabricName,
        r.component,
        r.print,
        r.processName,
        r.dia,
        String(r.sentWt),
        String(r.lossPct),
        String(r.receivedWt),
      ]);
    }
  }
  download(`${stem("PrintingRequirement", data.header)}.csv`, toCsv(rows), "text/csv");
}
