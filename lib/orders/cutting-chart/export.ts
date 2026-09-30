/**
 * Cutting Chart — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. It is handed the SAME `CuttingChart` the on-screen view renders, so
 * the page, the paper and the spreadsheet cannot disagree.
 *
 * The order documents' frame (green rule, logo, blue title) so they print as
 * one family; the body is the legacy RP Cutting Chart's — sizes across, Order /
 * Approval / Rej.Allow / Total per colour, and the three signatures at the foot.
 *
 * THE SHEET FORMAT (user 2026-09-29, "this is okay apply it" — the approved
 * "Raagam Requirement Sheet" design): a masthead drawn to the kit's design that
 * keeps the chart's centred "<COMPANY> — CUTTING CHART" identity (the same
 * day's spec) with the RE No large at the right; the facts as a label/value
 * grid; the quantity drawn as the sum it is; summary tiles; and the chart as a
 * CUTTING card — tone header with the Cut Qty, clean table, style bands and
 * Total rows tinted, a swatch per colour. Every figure the chart printed before
 * is still here. Pale tints under dark ink, so a mono printout still reads.
 */
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  STAGE_STYLES,
  SWATCH_PADDING,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawQtyEquation,
  drawSheetLabel,
  drawStageStripe,
  drawSwatch,
  paintRow,
  rgb,
} from "@/lib/orders/report-pdf-kit";
import { cuttingCell, cuttingRows, sumOf, type CuttingChart, type CuttingFigures } from "./types";

export type PdfOutput = "download" | "print";

function stem(c: CuttingChart): string {
  const key = (c.header.scNo || "order").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Cutting-Chart_${key}`;
}

/** The chart table's own header line per style — RE No first (user 2026-09-29:
 *  "move RE No into the table header"; it left the boxed header above, where it
 *  was printed twice), then Order No, Style and Description, which appear
 *  nowhere else on the chart. "Style" is the ref — Order Entry's Style — and
 *  never reads "Style Ref No" (user 2026-09-29); the style's name beside it
 *  reads "Description". */
export function styleLine(c: CuttingChart, s: CuttingChart["styles"][number]): string {
  return [
    c.header.scNo ? `RE No: ${c.header.scNo}` : null,
    c.header.orderNo ? `Order No: ${c.header.orderNo}` : null,
    s.styleRefNo ? `Style: ${s.styleRefNo}` : null,
    s.styleName ? `Description: ${s.styleName}` : null,
  ]
    .filter(Boolean)
    .join("     ");
}

/**
 * THE LEGACY'S BOXED HEADER, as its four columns — each read DOWN, the way the
 * RP printout lays them out (client 2026-09-23):
 *
 *   Date · Customer | Earlier Shipment Date · Order Qty |
 *   Excess Qty · Approval Qty · Net Qty | Rej.Allow Qty · Cut Qty
 *
 * RE No LEFT THIS BOX (user 2026-09-29): it leads the chart table's own header
 * line (`styleLine`), which printed it a second time. "Delivery Window" became
 * "Earlier Shipment Date" (same spec) — and prints THAT field's value
 * (`header.earlierShipment`), never the delivery date under its name.
 *
 * Legacy's "S.Q.No" and "S.Q.Qty" read RE No and Cut Qty (the SQ term is
 * retired). Its "Description" printed the RE number beside the SQ number — with
 * one number now, it would say RE No twice, so it is not repeated. Excess Qty is
 * always listed, blank when the order has none, as the legacy prints it.
 */
export function headerColumns(c: CuttingChart): [string, string][][] {
  const h = c.header;
  const n = (v: number) => v.toLocaleString("en-IN");
  return [
    [
      ["Date", fmtDate(h.date)],
      ["Customer", h.customer ?? "—"],
    ],
    [
      ["Earlier Shipment Date", fmtDate(h.earlierShipment)],
      ["Order Qty", `${n(h.orderQty)} PCS`],
    ],
    [
      ["Excess Qty", h.excessPct > 0 ? `${n(h.excessQty)} (${h.excessPct}%)` : ""],
      ["Approval Qty", n(h.approvalQty)],
      ["Net Qty", n(h.netQty)],
    ],
    [
      ["Rej.Allow Qty", n(h.rejectionQty)],
      ["Cut Qty", n(h.cutQty)],
    ],
  ];
}

/** The same facts flat, for the spreadsheet — RE No first, since the flat file
 *  has no table band to carry it at the top. */
export function headerFacts(c: CuttingChart): [string, string][] {
  return [["RE No", c.header.scNo ?? "—"], ...headerColumns(c).flat()];
}

/**
 * THE SHEET FORMAT'S FACTS (2026-09-29) — the boxed header's non-quantity facts
 * as a label / value grid; the quantities move to the sum below
 * (`chartQtyTerms`). The delivery date rides under the Earlier Shipment Date as
 * its sub-line, stated without taking the other's name.
 */
export function chartFacts(c: CuttingChart): { label: string; value: string; sub?: string | null }[] {
  const h = c.header;
  return [
    { label: "Date", value: fmtDate(h.date) },
    { label: "Customer", value: h.customer ?? "—" },
    {
      label: "Earlier Shipment Date",
      value: fmtDate(h.earlierShipment),
      sub: h.deliveryFrom ? `Delivery ${fmtDate(h.deliveryFrom)}` : null,
    },
  ];
}

/** Order + Excess + Approval + Rej.Allow = Cut, with the Net Qty (Order +
 *  Excess + Approval) as the Approval term's note — the boxed header's five
 *  figures, none dropped. Excess stays a term at 0, as the legacy lists it. */
export function chartQtyTerms(c: CuttingChart) {
  const h = c.header;
  const n = (v: number) => v.toLocaleString("en-IN");
  return {
    terms: [
      { label: "Order", value: n(h.orderQty), note: "pcs" },
      { label: "Excess", value: n(h.excessQty), note: h.excessPct > 0 ? `${h.excessPct}%` : null },
      { label: "Approval", value: n(h.approvalQty), note: `Net ${n(h.netQty)}` },
      { label: "Rej. Allow", value: n(h.rejectionQty), note: null },
    ],
    result: { label: "Cut Qty", value: n(h.cutQty), note: "pcs" },
  };
}

/* The spreadsheet gets bare digits — a grouped "3,024" is a string to Excel
   and would not sum. */
const rawCell = (n: number) => (n ? String(n) : "");

function figureRows(c: CuttingChart, first: string, f: CuttingFigures, fmt = cuttingCell): string[][] {
  return cuttingRows(c).map((r, i) => [i === 0 ? first : "", r.label, ...f[r.key].map(fmt), fmt(sumOf(f[r.key]))]);
}

export async function exportCuttingChartPdf(c: CuttingChart, output: PdfOutput = "download"): Promise<void> {
  /* THE TAB OPENS BEFORE ANY AWAIT — a popup opened after one is no longer
     "in response to the click" and the browser blocks it. */
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const h = c.header;
  const co = h.company;

  /* THE MASTHEAD, TO THE SHEET FORMAT'S DESIGN — the four-stage stripe, the
     logo (or the Raagam mark) at the left, "<COMPANY> — CUTTING CHART" as ONE
     centred title (user 2026-09-29), the unit under it, the RE No large at the
     right, and the dark rule. The kit's masthead puts the company at the left,
     so this one is drawn here with the kit's own measures. */
  drawStageStripe(doc, M, 14, W - 2 * M, 4);
  const top = 28;
  const logo = await loadLetterheadImage(co.logo);
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 96, 32);
    doc.addImage(logo.dataUrl, "PNG", M, top, w, lh);
  } else {
    doc.setFillColor(3, 123, 184);
    doc.roundedRect(M, top, 30, 30, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text((co.name ?? "R").trim().charAt(0).toUpperCase(), M + 15, top + 20.5, { align: "center" });
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M + 22, top + 22, 10, 10, 2, 2, "F");
    doc.setFillColor(133, 194, 39);
    doc.roundedRect(M + 23.5, top + 23.5, 7, 7, 1.5, 1.5, "F");
  }
  const company = (co.name ?? "RAAGAM EXPORTS").toUpperCase();
  const docName = " — CUTTING CHART";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const wCo = doc.getTextWidth(company);
  const wDoc = doc.getTextWidth(docName);
  const tx = (W - wCo - wDoc) / 2;
  doc.setTextColor(23, 32, 43);
  doc.text(company, tx, top + 14);
  doc.setTextColor(3, 123, 184);
  doc.text(docName, tx + wCo, top + 14);
  if (co.unit) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(123, 133, 148);
    doc.setCharSpace(0.5);
    doc.text(co.unit.toUpperCase(), W / 2, top + 25, { align: "center" });
    doc.setCharSpace(0);
  }
  if (h.scNo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(123, 133, 148);
    doc.text("RE NO", W - M, top + 6, { align: "right" });
    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.setTextColor(23, 32, 43);
    doc.text(h.scNo, W - M, top + 21, { align: "right" });
  }
  doc.setDrawColor(23, 32, 43);
  doc.setLineWidth(1.2);
  doc.line(M, top + 42, W - M, top + 42);
  doc.setLineWidth(0.4);
  doc.setDrawColor(0);
  doc.setTextColor(0);

  let y = drawOrderFacts(doc, top + 52, chartFacts(c), { margin: M, cols: 4 });
  const q = chartQtyTerms(c);
  y = drawSheetLabel(doc, M, y + 6, "Quantity to cut");
  y = drawQtyEquation(doc, y, q.terms, q.result, M);
  /* NO SUMMARY TILES ON THE CHART: its headline figures ARE the sum above
     (Cut, and Net as the Approval term's note), and a landscape page has no
     height to spare for saying them twice — the chart and its signatures stay
     on one sheet. */

  const tone = STAGE_STYLES.cutting;
  const nCols = c.sizes.length + 3;
  const body: RowInput[] = [];
  /* Row index -> how it is drawn: a style / RE Total band, a Total row, or a
     colour's first row (its swatch). */
  const bands = new Set<number>();
  const totals = new Set<number>();
  const swatchAt = new Map<number, string>();
  const pushFigures = (first: string, f: CuttingFigures) => {
    const hex = first ? swatchFor(first) : null;
    if (hex) swatchAt.set(body.length, hex);
    for (const row of figureRows(c, first, f)) {
      if (row[1] === "Total") totals.add(body.length);
      body.push(row);
    }
  };
  const band = (content: string) => {
    bands.add(body.length);
    body.push([{ content, colSpan: nCols }]);
  };
  for (const s of c.styles) {
    band(styleLine(c, s));
    for (const col of s.colours) pushFigures(col.combo, col.figures);
  }
  band("RE Total");
  pushFigures("", c.total);

  const numeric: Record<number, { halign: "right" }> = {};
  for (let i = 2; i < nCols; i++) numeric[i] = { halign: "right" };
  /* THE CHART AS A CUTTING CARD — its headline figure, the RE's Cut Qty, at
     the right (the RE Total block's own Total, so card and table agree). */
  const startY = drawCardHeader(
    doc,
    M,
    y + 4,
    W - 2 * M,
    tone,
    "Cutting Chart",
    cuttingCell(sumOf(c.total.total)),
    "Cut Qty",
  );

  autoTable(doc, {
    head: [["Color", "", ...c.sizes.map((z) => z.label), "Total"]],
    body,
    startY,
    margin: { left: M, right: M, top: 36 },
    theme: "plain",
    styles: { ...cardTableStyles(), fontSize: 7.8 },
    headStyles: cardTableHead(),
    columnStyles: { ...numeric, [nCols - 1]: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      // The Total row of every block reads bold and tinted, as the legacy's bold.
      paintRow(d, { tone, totals });
      // Size and Total headings sit over their right-aligned figures.
      if (d.section === "head" && d.column.index >= 2) d.cell.styles.halign = "right";
      if (d.section !== "body") return;
      if (bands.has(d.row.index)) {
        d.cell.styles.fillColor = rgb(tone.tint);
        d.cell.styles.textColor = rgb(tone.ink);
        d.cell.styles.fontStyle = "bold";
      }
      if (d.column.index === 0 && swatchAt.has(d.row.index)) d.cell.styles.cellPadding = SWATCH_PADDING;
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 0) return;
      const hex = swatchAt.get(d.row.index);
      if (hex) drawSwatch(doc, d.cell, hex);
    },
  });

  const H = doc.internal.pageSize.getHeight();
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  /* Prepared / Checked / Approved, each over its own rule (the sheet format). */
  /* At the foot of the chart's own page when it fits; a page of its own only
     when the chart has filled this one. */
  let sigY = Math.min(endY + 48, H - 52);
  if (sigY < endY + 22) {
    doc.addPage();
    sigY = 70;
  }
  const colW = (W - 2 * M - 2 * 28) / 3;
  doc.setDrawColor(23, 32, 43);
  doc.setLineWidth(0.6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(23, 32, 43);
  ["Prepared By", "Checked By", "Approved By"].forEach((label, i) => {
    const x = M + i * (colW + 28);
    doc.line(x, sigY, x + colW, sigY);
    doc.text(label, x, sigY + 11);
  });

  const printed = `Printed ${fmtDateTime(new Date().toISOString())}`;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(221, 226, 232);
    doc.setLineWidth(0.5);
    doc.line(M, H - 30, W - M, H - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(123, 133, 148);
    doc.text(`${h.scNo ?? ""}  ·  Cutting Chart  ·  ${printed}`, M, H - 20);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: "right" });
  }

  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  // A blocked print tab falls back to the download.
  doc.save(`${stem(c)}.pdf`);
}

/** Excel as a flat CSV — header facts lead the file once, then the chart. */
export function exportCuttingChartCsv(c: CuttingChart): void {
  const lines: string[][] = [
    ["Cutting Chart"],
    ...headerFacts(c).map(([k, v]) => [k, v]),
    [],
    ["Color", "", ...c.sizes.map((z) => z.label), "Total"],
  ];
  for (const s of c.styles) {
    lines.push([styleLine(c, s)]);
    for (const col of s.colours) lines.push(...figureRows(c, col.combo, col.figures, rawCell));
  }
  lines.push(["RE Total"], ...figureRows(c, "", c.total, rawCell));
  const csv = lines
    .map((line) => line.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
    .join("\n");
  // The BOM prefix keeps Excel reading UTF-8 and not a leading `=` as a formula.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(c)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
