/**
 * Material BOM Requirement — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. It is handed the SAME `MbaRequirementReport` the on-screen view
 * renders, so the page, the paper and the spreadsheet cannot disagree.
 *
 * THE SHEET FORMAT (user 2026-09-29: "this is okay apply it"). Masthead (mark,
 * company, kind, RE No large), the order's facts as a grid, the tiles the
 * reader came for, then the table as a CARD with the line count, light rules,
 * rows striped, the item colour swatched — `lib/orders/report-pdf-kit.ts`, one
 * format for every order sheet, the same blocks the screen renders. This replaced "MONO TABLE, BRAND ON THE RULES", whose worry was a
 * SATURATED head band turning to mud on a supplier's mono laser: the kit's
 * fills are pale tints under near-black ink, which a mono printer renders as
 * light greys and never as mud.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import type { MbaRequirementReport } from "./requirement-report-types";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  BRAND,
  CONTINUED_TOP,
  SWATCH_PADDING,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  drawSwatch,
  paintRow,
} from "@/lib/orders/report-pdf-kit";
import { signOffFooter } from "@/lib/orders/fabric-bom/reports-export";
import { fmtQty } from "@/lib/uom/convert";

export type PdfOutput = "download" | "print";

/* "Purchase Qty" JOINED ON 2026-09-20 and sits BEFORE its unit — the paper and
   the spreadsheet print what the screen prints, column for column. */
/* THE REPORT STANDARD'S ORDER (user 2026-09-29) for the columns shared with it
   — Item Name → Color → UOM → Required Qty; Calculated Qty (Required before
   process loss) stays beside Required. Screen, PDF and CSV read this list. */
const HEAD = [
  "Item Name",
  "Item Color",
  "Uom",
  "Calculated Qty",
  "Required Qty",
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
    x.uom,
    x.calculated != null ? fmtQty(x.calculated, x.decimals) : "—",
    x.required != null ? fmtQty(x.required, x.decimals) : (x.refusal ?? "—"),
    x.purchaseQty != null ? fmtQty(x.purchaseQty, x.purchaseDecimals) : "—",
    x.purchaseUom,
    x.stage,
  ]);
}

/**
 * THE SHEET'S TILES (2026-09-29) — counts of the lines it prints, never a sum
 * across units (pieces and grams add to no figure). The screen reads this too.
 */
export function mbomRequirementTiles(r: MbaRequirementReport): { label: string; value: number; note: string }[] {
  const n = r.rows.length;
  const items = new Set(r.rows.map((x) => x.material)).size;
  const toBuy = r.rows.filter((x) => x.purchaseQty != null).length;
  const refused = r.rows.filter((x) => x.required == null).length;
  const tiles = [
    { label: "Material lines", value: n, note: `${items} item${items === 1 ? "" : "s"}` },
    { label: "To purchase", value: toBuy, note: `line${toBuy === 1 ? "" : "s"} with a purchase quantity` },
  ];
  if (refused) tiles.push({ label: "Not worked out", value: refused, note: "see the reason on the line" });
  return tiles;
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

  /* THE MASTHEAD AND THE ORDER'S FACTS (sheet format, 2026-09-29). */
  const logo = await loadLetterheadImage(c.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: c.name,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Accessories Plan Requirement",
    reNo: h.scNo,
    meta: [h.bomCode, h.computedAt ? `Stored ${fmtDateTime(h.computedAt)}` : null].filter(Boolean).join(" · "),
    margin: M,
  });
  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: h.customer },
      { label: "Order No", value: h.orderNo },
      { label: "BOM Date", value: h.bomDate ? fmtDate(h.bomDate) : null },
    ],
    { margin: M, cols: 3 },
  );
  y = drawSheetLabel(doc, M, y + 4, "Summary");
  y = drawSummaryTiles(
    doc,
    y,
    mbomRequirementTiles(r).map((t) => ({ label: t.label, value: String(t.value), note: t.note, tone: BRAND })),
    M,
  );

  /* THE TABLE AS A CARD — BRAND blue (a trim is not a production stage, so no
     tag), the line count at the right. No total row: the lines are in
     different units, and a sum of pieces and grams is no figure. */
  const n = r.rows.length;
  const startY = drawCardHeader(doc, M, y + 2, W - 2 * M, BRAND, "Material Requirement", `${n} line${n === 1 ? "" : "s"}`);
  const swatches = r.rows.map((x) => swatchFor(x.colour));

  autoTable(doc, {
    head: [HEAD],
    body: body(r),
    startY,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: { ...cardTableStyles(), fontSize: 7.8 },
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold" }, 5: { halign: "right" } },
    didParseCell: (d) => {
      /* A figure column's heading sits over its figures, on the right. */
      if (d.section === "head" && [3, 4, 5].includes(d.column.index)) d.cell.styles.halign = "right";
      paintRow(d, { tone: BRAND });
      if (d.section !== "body") return;
      if (d.column.index === 1 && swatches[d.row.index]) d.cell.styles.cellPadding = SWATCH_PADDING;
      /* A refused Required Qty is its sentence, not a figure — plain weight. */
      if (d.column.index === 4 && r.rows[d.row.index]?.required == null) {
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

  /* PREPARED / CHECKED / APPROVED — on a page of its own when the table ran
     into the sign-off band. */
  const tableEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  if (tableEnd > doc.internal.pageSize.getHeight() - 70) doc.addPage();
  signOffFooter(doc);

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
    ["Accessories Plan Requirement", h.bomCode ?? ""],
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
