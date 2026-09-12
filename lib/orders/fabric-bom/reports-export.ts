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
import type { BomDocHeader, EntryRegister, YarnFabricRequirementReport } from "./reports";
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
      `Cut Qty ${fmtNumber(header.qty.orderQty)}    Excess Qty ${fmtNumber(header.qty.excessQty)}` +
        `    Rejection Allowance ${fmtNumber(header.qty.rejectionQty)}    Approval Allowance ${fmtNumber(header.qty.approvalQty)}` +
        `    SQ Qty ${fmtNumber(header.qty.sqQty)}`,
      M,
      y,
    );
    doc.setTextColor(0);
  }

  return y + 10;
}

function pageFooter(doc: jsPDF, header: BomDocHeader): void {
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
    doc.text(`Page ${p} / ${pages}`, RIGHT, doc.internal.pageSize.getHeight() - 20, { align: "right" });
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
  "SQ Qty",
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
          sz.dia != null ? fmtNumber(sz.dia) : "",
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
      // GSM(4), Dia/Size(6), Width(7), SQ Qty(8), Piece Wt(9), Wastage %(10),
      // Net Req Wt(11), Loss %(12), Total (Gross) Wt(13) — every numeric
      // column in REGISTER_COLUMNS; Size(5) is a label, not a figure.
      4: { halign: "right" },
      6: { halign: "right" },
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
      head: [["Class", "Item", "Stage", "Process", "Loss %"]],
      body: data.stageLedger.map((r) => [
        r.className,
        r.itemName,
        r.stageName ?? "",
        r.processName ?? "",
        r.lossPct != null ? `${r.lossPct.toFixed(2)}%` : "",
      ]),
      startY,
      margin: { left: M, right: M },
      styles: monoStyles(),
      headStyles: monoHead(),
      columnStyles: { 4: { halign: "right" } },
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
          sz.dia != null ? String(sz.dia) : "",
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

export function exportYarnRequirementPdf(data: YarnFabricRequirementReport): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const y = drawLetterhead(doc, data.header, "Yarn & Fabric Requirement Report", yarnReportFacts(data.header));

  // COLUMN-FOR-COLUMN WITH THE LEGACY PRINTOUT — Stage | Type | Yarn | Color |
  // Plan Wt | Loss % | To Ordered Wt, ending in a Total row. Loss % is always
  // blank here: the legacy PDF's own Yarn Requirement table leaves it blank
  // on every row too (the loss already lives in the Process Stage Ledger
  // below, applied to the FABRIC, never re-charged to the yarn a second time).
  autoTable(doc, {
    head: [["Stage", "Type", "Yarn Description", "Color", "Plan Wt", "Loss %", "To Ordered Wt"]],
    body: [
      ...data.yarns.map((r) => [
        r.stageState,
        r.itemType,
        r.yarnName,
        r.color ?? "",
        r.purchaseQty != null ? fmtNumber(r.purchaseQty) : "",
        "",
        r.purchaseQty != null ? fmtNumber(r.purchaseQty) : (r.refusalReason ?? ""),
      ]),
      ...(data.yarnGrandTotal
        ? [[
            "",
            "",
            "TOTAL YARN PURCHASE REQUIREMENT",
            "",
            fmtNumber(data.yarnGrandTotal.qty),
            "",
            fmtNumber(data.yarnGrandTotal.qty),
          ]]
        : []),
    ],
    startY: y,
    margin: { left: M, right: M },
    styles: monoStyles(),
    headStyles: monoHead(),
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === data.yarns.length && data.yarnGrandTotal) {
        d.cell.styles.fontStyle = "bold";
      }
    },
  });

  for (const g of data.stageBreakdown) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    const startY = (after?.finalY ?? y) + 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(g.processName.toUpperCase(), M, startY - 6);
    autoTable(doc, {
      head: [["Details", "Colour", "Planned Wt", "Loss %", "To Ordered Wt"]],
      body: [
        ...g.lines.map((l) => [
          l.fabricName,
          l.combo ?? "",
          fmtNumber(l.plannedWt),
          `${l.lossPct.toFixed(2)}%`,
          fmtNumber(l.toOrderedWt),
        ]),
        ["Grand Total", "", fmtNumber(g.plannedTotal), "", fmtNumber(g.toOrderedTotal)],
      ],
      startY,
      margin: { left: M, right: M },
      styles: monoStyles(),
      headStyles: monoHead(),
      columnStyles: { 2: { halign: "right" }, 4: { halign: "right" } },
      didParseCell: (d) => {
        if (d.section === "body" && d.row.index === g.lines.length) {
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
  }

  pageFooter(doc, data.header);
  doc.save(`${stem("YarnFabricRequirement", data.header)}.pdf`);
}

export function exportYarnRequirementCsv(data: YarnFabricRequirementReport): void {
  const rows: string[][] = [
    ["Section", "Stage", "Type", "Yarn / Fabric", "Color", "Planned Wt", "Loss %", "To Ordered Wt", "Unit", "Note"],
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
      y.purchaseQty != null ? String(y.purchaseQty) : "",
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
      String(data.yarnGrandTotal.qty),
      data.yarnGrandTotal.uomCode ?? "",
      "",
    ]);
  }
  for (const g of data.stageBreakdown) {
    for (const l of g.lines) {
      rows.push([
        g.processName,
        "",
        "",
        l.fabricName,
        l.combo ?? "",
        String(l.plannedWt),
        String(l.lossPct),
        String(l.toOrderedWt),
        "",
        "",
      ]);
    }
  }
  download(`${stem("YarnFabricRequirement", data.header)}.csv`, toCsv(rows), "text/csv");
}
