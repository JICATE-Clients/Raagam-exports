import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import {
  CONTINUED_TOP,
  drawSheetHeader,
  finalY,
  finishPdf,
  openPrintTab,
  pageFooter,
  signOffFooter,
  type PdfOutput,
} from "@/lib/orders/fabric-bom/reports-export";
import { loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  BRAND,
  SWATCH_PADDING,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawSheetLabel,
  drawSummaryTiles,
  drawSwatch,
  paintRow,
  roomFor,
  rgb,
} from "@/lib/orders/report-pdf-kit";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import { ACCESSORY_COLUMNS, accessoryQty, accessoryRows, type AccessoryRow } from "./sheet";
import type { RequirementSheetData } from "./service";

/**
 * THE ACCESSORIES REQUIREMENT, AS THE RP PRINTOUT (client 2026-09-24,
 * "Accessories Requirement.pdf").
 *
 * Portrait A4, the legacy header band shared with the Yarn & Fabric
 * Requirement (`drawLegacyRequirementHeader` — centred company and title,
 * "Report Printed Date & Time", Customer / Delivery, and the RE No / Order No /
 * Style Ref No / Style / Unit row over Order · Excess · Approval · Rej.Allow ·
 * Cut), then TRIMS PURCHASE in the printout's eight columns, and the
 * Prepared / Checked / Approved sign-off. `Page : n/m` top right, as legacy.
 *
 * TWO DEPARTURES FROM THE PRINTOUT, both standing decisions rather than
 * choices made here: its SQ No / SQ Description are gone and its "SQ" column
 * reads Cut (client 2026-09-23 — "SQ" was read as Sample Quantity), and "SC No"
 * reads RE No (the app's name for it since 0431).
 *
 * THE SHEET FORMAT (user 2026-09-29, the approved "Raagam Requirement Sheet"):
 * the masthead / order facts / quantity sum opening (`drawSheetHeader`), the
 * trims' count tiles, then TRIMS PURCHASE as a card. Page numbers at the foot.
 *
 * THE YARN & FABRIC LOOK, STILL PRINT-SAFE (user 2026-09-29: the other
 * reports "need to look like yarn fabric requirement"). This used to say
 * "MONO, NOT BRANDED" — a supplier prints it on a mono laser, and a saturated
 * head band turns to mud there. The look it now wears is not that: every fill
 * is a PALE tint under near-black ink (`report-pdf-kit.ts`), so the sections
 * still separate in greyscale. TRIMS PURCHASE is a filled `BRAND` bar with
 * its item count, the head in the same tint, rows striped, each category's
 * group cell tinted, and a swatch beside a colour the palette knows.
 */

function stem(data: RequirementSheetData): string {
  const key = (data.order.scNo || data.bom.code || "sheet").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `AccessoriesRequirement_${key}`;
}

/** One printout row as the eight cells, the category merged over its group. */
function cells(r: AccessoryRow): RowInput {
  const row: RowInput = [];
  if (r.category != null) row.push({ content: r.category, rowSpan: r.span });
  // ACCESSORY_COLUMNS' order (user 2026-09-29).
  row.push(
    r.item,
    r.consumption,
    r.colour ?? "",
    r.size ?? "",
    r.spec ?? "",
    r.uom,
    r.qty == null ? (r.refusal ?? "—") : accessoryQty(r.qty),
  );
  return row;
}

export async function exportAccessoriesRequirementPdf(
  data: RequirementSheetData,
  output: PdfOutput = "download",
): Promise<void> {
  const tab = openPrintTab(output);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const M = 28;
  const W = doc.internal.pageSize.getWidth() - 2 * M;

  /* A SHEET WITHOUT A HEADER (the order's quantities refused to load at the
     very top) still prints — its body is what the supplier buys against. */
  const header = isReportRefusal(data.header) ? null : data.header;
  let y = 40;
  if (header) {
    const logo = await loadLetterheadImage(header.company.logo);
    y = drawSheetHeader(doc, header, "Accessories Requirement", logo);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ACCESSORIES REQUIREMENT", doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 30, 30);
    if (isReportRefusal(data.header)) doc.text(data.header.refused, M, (y += 14));
    doc.setTextColor(0);
    y += 12;
  }

  const rows = accessoryRows(data.rows, data.names);
  /* THE SUMMARY — counts the sheet already lists, nothing computed anew:
     trim lines, categories, and any line whose quantity could not be worked
     out (the supplier's unanswered question). */
  const categories = rows.filter((r) => r.category != null).length;
  const unplanned = rows.filter((r) => r.qty == null).length;
  if (rows.length) {
    y = drawSheetLabel(doc, M, y + 2, "This sheet");
    y = drawSummaryTiles(doc, y, [
      { label: "Trim lines", value: String(rows.length), note: "to purchase", tone: BRAND },
      { label: "Categories", value: String(categories), note: "item groups", tone: BRAND },
      ...(unplanned
        ? [{ label: "Unplanned", value: String(unplanned), note: "quantity not worked out", tone: BRAND }]
        : []),
    ]);
  }

  // -- TRIMS PURCHASE, as a card ---------------------------------------------
  y = roomFor(doc, y, 90);
  const startY = drawCardHeader(
    doc,
    M,
    y + 4,
    W,
    BRAND,
    "Trims Purchase",
    rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"}` : null,
  );
  /* Which body rows open a category — their first cell is the rowSpan group
     cell, tinted as the group's own heading. */
  const opensGroup = new Set(rows.flatMap((r, i) => (r.category != null ? [i] : [])));
  autoTable(doc, {
    head: [[...ACCESSORY_COLUMNS]],
    body: rows.map(cells),
    startY,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: { ...cardTableStyles(), valign: "top" },
    headStyles: cardTableHead(),
    theme: "plain",
    /* Category · Item Name · Consumption · Color · Size · Specification ·
       UOM · Required Qty — 64 + 140 + 66 + 52 + 40 + 78 + 34 = 474 of the
       page's 539pt, the last ~65pt for the quantity. */
    columnStyles: {
      0: { cellWidth: 64 },
      1: { cellWidth: 140 },
      2: { cellWidth: 66 },
      3: { cellWidth: 52 },
      4: { cellWidth: 40 },
      5: { cellWidth: 78 },
      6: { cellWidth: 34 },
      7: { halign: "right" },
    },
    didParseCell: (d) => {
      paintRow(d, { tone: BRAND });
      /* Qty's heading over its right-aligned figures, as the screen sets it. */
      if (d.section === "head" && d.column.index === 7) d.cell.styles.halign = "right";
      if (d.section !== "body") return;
      /* THE CATEGORY'S GROUP CELL — tinted in the tone, over its whole span. */
      if (d.column.index === 0 && opensGroup.has(d.row.index)) {
        d.cell.styles.fillColor = rgb(BRAND.tint);
        d.cell.styles.textColor = rgb(BRAND.ink);
        d.cell.styles.fontStyle = "bold";
      }
      if (d.column.index === 3 && swatchFor(String(d.cell.raw ?? ""))) d.cell.styles.cellPadding = SWATCH_PADDING;
      /* A refused quantity is a sentence, set in red where the figure would be. */
      const raw = String(d.cell.raw ?? "");
      if (d.column.index === 7 && raw && !/^[\d,.—]+$/.test(raw)) {
        d.cell.styles.textColor = [150, 30, 30];
        d.cell.styles.halign = "left";
      }
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 3) return;
      const hex = swatchFor(String(d.cell.raw ?? ""));
      if (hex) drawSwatch(doc, d.cell, hex);
    },
  });
  if (rows.length === 0) {
    doc.setFontSize(7.5);
    doc.text("No trims on this Accessories Plan.", M, finalY(doc, startY) + 12);
  }

  signOffFooter(doc);
  if (header) pageFooter(doc, header);
  finishPdf(doc, `${stem(data)}.pdf`, output, tab);
}

/** The same grid as CSV (the Excel button) — the same eight columns in the
 *  same order, the category repeated on every row so a filter in Excel still
 *  works. */
export function accessoriesCsv(data: RequirementSheetData): string {
  const out: string[][] = [[...ACCESSORY_COLUMNS]];
  let category = "";
  for (const r of accessoryRows(data.rows, data.names)) {
    if (r.category != null) category = r.category;
    out.push([
      category,
      r.item,
      r.consumption,
      r.colour ?? "",
      r.size ?? "",
      r.spec ?? "",
      r.uom,
      r.qty == null ? (r.refusal ?? "") : r.qty.toFixed(3),
    ]);
  }
  return out
    .map((line) => line.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function exportAccessoriesCsv(data: RequirementSheetData): void {
  const blob = new Blob(["﻿" + accessoriesCsv(data)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(data)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
