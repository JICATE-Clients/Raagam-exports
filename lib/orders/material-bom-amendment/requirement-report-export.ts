/**
 * Material BOM Requirement — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. It is handed the SAME `MbaRequirementReport` the on-screen view
 * renders, so the page, the paper and the spreadsheet cannot disagree.
 *
 * THE YARN & FABRIC LOOK (user 2026-09-29: "another reports also need to look
 * like yarn fabric requirement"). The table sits under a filled BRAND section
 * bar with the line count, its head in the same tint, rows striped, the item
 * colour swatched — `lib/orders/report-pdf-kit.ts`, one look for every order
 * report. This replaced "MONO TABLE, BRAND ON THE RULES", whose worry was a
 * SATURATED head band turning to mud on a supplier's mono laser: the kit's
 * fills are pale tints under near-black ink, which a mono printer renders as
 * light greys and never as mud. The green rule and blue title stay.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import type { MbaRequirementReport } from "./requirement-report-types";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  BRAND,
  SWATCH_PADDING,
  drawSectionHeading,
  drawSwatch,
  paintRow,
  toneHead,
} from "@/lib/orders/report-pdf-kit";
import { fmtQty } from "@/lib/uom/convert";

export type PdfOutput = "download" | "print";

/* "Purchase Qty" JOINED ON 2026-09-20 and sits BEFORE its unit — the paper and
   the spreadsheet print what the screen prints, column for column. */
const HEAD = [
  "Item Name",
  "Item Color",
  "Calculated Qty",
  "Required Qty",
  "Uom",
  "Purchase Qty",
  "Purchase Uom",
  "Stage",
];

function stem(r: MbaRequirementReport): string {
  const key = (r.header.scNo || r.header.bomCode || "bom").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Material-BOM-Requirement_${key}`;
}

function body(r: MbaRequirementReport): string[][] {
  return r.rows.map((x) => [
    x.material,
    x.colour,
    x.calculated != null ? fmtQty(x.calculated, x.decimals) : "—",
    x.required != null ? fmtQty(x.required, x.decimals) : (x.refusal ?? "—"),
    x.uom,
    x.purchaseQty != null ? fmtQty(x.purchaseQty, x.purchaseDecimals) : "—",
    x.purchaseUom,
    x.stage,
  ]);
}

export async function exportMaterialBomRequirementPdf(
  r: MbaRequirementReport,
  output: PdfOutput = "download",
): Promise<void> {
  /* THE TAB OPENS BEFORE ANY AWAIT — a popup opened after one is no longer
     "in response to the click" and the browser blocks it. */
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const h = r.header;
  const c = h.company;

  doc.setFillColor(133, 194, 39);
  doc.rect(M, 24, W - 2 * M, 3, "F");

  let x = M;
  const logo = await loadLetterheadImage(c.logo);
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 110, 36);
    doc.addImage(logo.dataUrl, "PNG", M, 36, w, lh);
    x = M + w + 12;
  }
  doc.setTextColor(22, 24, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text((c.name ?? "RAAGAM EXPORTS").toUpperCase(), x, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(91, 100, 114);
  const contact = [c.address, c.gstin ? `GSTIN ${c.gstin}` : null].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, x, 62, { maxWidth: W - x - 220 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(3, 123, 184);
  doc.text("MATERIAL BOM REQUIREMENT", W - M, 50, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(91, 100, 114);
  if (h.bomCode) doc.text(h.bomCode, W - M, 62, { align: "right" });

  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1.2);
  doc.line(M, 78, W - M, 78);

  doc.setFontSize(9);
  doc.setTextColor(20);
  const facts = [
    h.customer ? `Customer: ${h.customer}` : null,
    h.scNo ? `RE No: ${h.scNo}` : null,
    h.orderNo ? `Order No: ${h.orderNo}` : null,
    h.bomDate ? `Date: ${fmtDate(h.bomDate)}` : null,
  ].filter(Boolean) as string[];
  if (facts.length) doc.text(facts.join("     "), M, 94);

  /* THE SECTION BAR — BRAND blue (a trim is not a production stage, so no
     tag), the line count at the right. No total row: the lines are in
     different units, and a sum of pieces and grams is no figure. */
  const n = r.rows.length;
  const startY = drawSectionHeading(
    doc,
    M,
    118,
    W - 2 * M,
    BRAND,
    "MATERIAL REQUIREMENT",
    `${n} line${n === 1 ? "" : "s"}`,
  );
  const swatches = r.rows.map((x) => swatchFor(x.colour));

  autoTable(doc, {
    head: [HEAD],
    body: body(r),
    startY,
    margin: { left: M, right: M },
    styles: { fontSize: 8, cellPadding: 3.5, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    headStyles: { ...toneHead(BRAND), fontSize: 7.5 },
    theme: "grid",
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" }, 5: { halign: "right" } },
    didParseCell: (d) => {
      /* A figure column's heading sits over its figures, on the right. */
      if (d.section === "head" && [2, 3, 5].includes(d.column.index)) d.cell.styles.halign = "right";
      paintRow(d, { tone: BRAND });
      if (d.section !== "body") return;
      if (d.column.index === 1 && swatches[d.row.index]) d.cell.styles.cellPadding = SWATCH_PADDING;
      /* A refused Required Qty is its sentence, not a figure — plain weight. */
      if (d.column.index === 3 && r.rows[d.row.index]?.required == null) {
        d.cell.styles.fontStyle = "normal";
        d.cell.styles.textColor = [110, 116, 128];
        d.cell.styles.halign = "left";
      }
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 1) return;
      const hex = swatches[d.row.index];
      if (hex) drawSwatch(doc, d.cell, hex);
    },
  });

  const pages = doc.getNumberOfPages();
  const H = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(h.computedAt ? `Requirement stored ${fmtDateTime(h.computedAt)}` : "", M, H - 20);
    doc.text(`Page ${p} / ${pages}`, W - M, H - 20, { align: "right" });
  }

  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  // A blocked print tab falls back to the download — the operator still gets
  // the document, just not the dialog.
  doc.save(`${stem(r)}.pdf`);
}

/** Excel as a flat CSV — the header facts on every row would be noise, so they
 *  lead the file once and the table follows. */
export function exportMaterialBomRequirementCsv(r: MbaRequirementReport): void {
  const h = r.header;
  const lines: string[][] = [
    ["Material BOM Requirement", h.bomCode ?? ""],
    ["Customer", h.customer ?? "", "RE No", h.scNo ?? "", "Order No", h.orderNo ?? ""],
    [],
    HEAD,
    ...body(r),
  ];
  const csv = lines
    .map((line) => line.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
    .join("\n");
  // The BOM prefix keeps Excel reading UTF-8 and not a leading `=` as a formula.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(r)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
