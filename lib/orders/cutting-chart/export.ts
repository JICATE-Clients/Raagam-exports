/**
 * Cutting Chart — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. It is handed the SAME `CuttingChart` the on-screen view renders, so
 * the page, the paper and the spreadsheet cannot disagree.
 *
 * The Material BOM Requirement exporter's frame (green rule, blue title, mono
 * table) so the order's documents print as one family; the body is the legacy
 * RP Cutting Chart's — sizes across, Order / Approval / Rej.Allow / Total per
 * colour, and the three signatures at the foot.
 */
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { cuttingCell, cuttingRows, sumOf, type CuttingChart, type CuttingFigures } from "./types";

export type PdfOutput = "download" | "print";

function stem(c: CuttingChart): string {
  const key = (c.header.scNo || "order").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Cutting-Chart_${key}`;
}

/** `Style Ref No · Style` — the block's identity line, as the legacy prints it. */
export function styleLine(c: CuttingChart, s: CuttingChart["styles"][number]): string {
  return [
    c.header.scNo ? `RE No: ${c.header.scNo}` : null,
    c.header.orderNo ? `Order No: ${c.header.orderNo}` : null,
    s.styleRefNo ? `Style Ref No: ${s.styleRefNo}` : null,
    s.styleName ? `Style: ${s.styleName}` : null,
  ]
    .filter(Boolean)
    .join("     ");
}

/**
 * THE LEGACY'S BOXED HEADER, as its four columns — each read DOWN, the way the
 * RP printout lays them out (client 2026-09-23):
 *
 *   RE No · Date · Customer | Delivery Window · Order Qty |
 *   Excess Qty · Approval Qty · Net Qty | Rej.Allow Qty · Cut Qty
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
      ["RE No", h.scNo ?? "—"],
      ["Date", fmtDate(h.date)],
      ["Customer", h.customer ?? "—"],
    ],
    [
      ["Delivery Window", `${fmtDate(h.deliveryFrom)} To ${fmtDate(h.deliveryTo)}`],
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

/** The same facts flat, for the spreadsheet. */
export function headerFacts(c: CuttingChart): [string, string][] {
  return headerColumns(c).flat();
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

  doc.setFillColor(133, 194, 39);
  doc.rect(M, 24, W - 2 * M, 3, "F");

  let x = M;
  const logo = await loadLetterheadImage(co.logo);
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 110, 36);
    doc.addImage(logo.dataUrl, "PNG", M, 36, w, lh);
    x = M + w + 12;
  }
  doc.setTextColor(22, 24, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text((co.name ?? "RAAGAM EXPORTS").toUpperCase(), x, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(91, 100, 114);
  const contact = [co.unit, co.address, co.gstin ? `GSTIN ${co.gstin}` : null].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, x, 62, { maxWidth: W - x - 220 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(3, 123, 184);
  doc.text("CUTTING CHART", W - M, 50, { align: "right" });

  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1.2);
  doc.line(M, 78, W - M, 78);

  /* THE LEGACY'S BOXED HEADER — four label/value column pairs, read down. */
  const hcols = headerColumns(c);
  const depth = Math.max(...hcols.map((col) => col.length));
  const factBody: string[][] = [];
  for (let i = 0; i < depth; i++) factBody.push(hcols.flatMap((col) => col[i] ?? ["", ""]));
  autoTable(doc, {
    body: factBody,
    startY: 86,
    margin: { left: M, right: M },
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    columnStyles: {
      0: { textColor: 120 },
      2: { textColor: 120 },
      4: { textColor: 120 },
      6: { textColor: 120 },
      1: { fontStyle: "bold" },
      3: { fontStyle: "bold" },
      5: { fontStyle: "bold" },
      7: { fontStyle: "bold" },
    },
  });

  const nCols = c.sizes.length + 3;
  const body: RowInput[] = [];
  for (const s of c.styles) {
    body.push([{ content: styleLine(c, s), colSpan: nCols, styles: { fontStyle: "bold", fillColor: [246, 247, 249] } }]);
    for (const col of s.colours) body.push(...figureRows(c, col.combo, col.figures));
  }
  body.push([{ content: "RE Total", colSpan: nCols, styles: { fontStyle: "bold", fillColor: [246, 247, 249] } }]);
  body.push(...figureRows(c, "", c.total));

  const numeric: Record<number, { halign: "right" }> = {};
  for (let i = 2; i < nCols; i++) numeric[i] = { halign: "right" };
  const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  autoTable(doc, {
    head: [["Color", "", ...c.sizes.map((z) => z.label), "Total"]],
    body,
    startY: lastY + 8,
    margin: { left: M, right: M },
    styles: { fontSize: 8, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    headStyles: { fillColor: [235, 237, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: { ...numeric, [nCols - 1]: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      // The Total row of every block reads bold, as the legacy prints it.
      if (d.section === "body" && Array.isArray(d.row.raw) && d.row.raw[1] === "Total") d.cell.styles.fontStyle = "bold";
    },
  });

  const H = doc.internal.pageSize.getHeight();
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const sigY = Math.min(endY + 60, H - 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text("Prepared By", M, sigY);
  doc.text("Checked By", W / 2, sigY, { align: "center" });
  doc.text("Approved By", W - M, sigY, { align: "right" });
  doc.setLineWidth(0.6);
  doc.line(M, sigY + 4, W - M, sigY + 4);

  const printed = `Printed ${fmtDateTime(new Date().toISOString())}`;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(printed, M, H - 20);
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
