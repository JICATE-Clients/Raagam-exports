import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import {
  CONTINUED_TOP,
  drawLegacyRequirementHeader,
  finalY,
  finishPdf,
  monoHead,
  monoStyles,
  openPrintTab,
  pageFooter,
  signOffFooter,
  stampTopPageNumbers,
  type PdfOutput,
} from "@/lib/orders/fabric-bom/reports-export";
import { loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
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
 * MONO, NOT BRANDED — a supplier prints this on a mono laser; the grey head is
 * the one fill (`monoHead`, the same as every other requirement document).
 */

function stem(data: RequirementSheetData): string {
  const key = (data.order.scNo || data.bom.code || "sheet").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `AccessoriesRequirement_${key}`;
}

/** One printout row as the eight cells, the category merged over its group. */
function cells(r: AccessoryRow): RowInput {
  const row: RowInput = [];
  if (r.category != null) row.push({ content: r.category, rowSpan: r.span });
  row.push(
    r.item,
    r.colour ?? "",
    r.spec ?? "",
    r.uom,
    r.size ?? "",
    r.qty == null ? (r.refusal ?? "—") : accessoryQty(r.qty),
    r.consumption,
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

  /* A SHEET WITHOUT A HEADER (the order's quantities refused to load at the
     very top) still prints — its body is what the supplier buys against. */
  const header = isReportRefusal(data.header) ? null : data.header;
  let y = 40;
  let printedY = 62;
  if (header) {
    const logo = await loadLetterheadImage(header.company.logo);
    ({ y, printedY } = drawLegacyRequirementHeader(doc, header, "Accessories Requirement", logo));
    /* The quantity band's own refusal ("fill Approval Qty on the order") —
       said where the figures would have been, never an empty row. */
    if (isReportRefusal(header.qty)) {
      doc.setFontSize(7);
      doc.setTextColor(150, 30, 30);
      doc.text(header.qty.refused, M, y + 10);
      doc.setTextColor(0);
      y += 14;
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ACCESSORIES REQUIREMENT", doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 30, 30);
    if (isReportRefusal(data.header)) doc.text(data.header.refused, M, (y += 14));
    doc.setTextColor(0);
  }

  // -- TRIMS PURCHASE ---------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("TRIMS PURCHASE", M, y + 14);
  doc.setFont("helvetica", "normal");

  const rows = accessoryRows(data.rows, data.names);
  autoTable(doc, {
    head: [[...ACCESSORY_COLUMNS]],
    body: rows.map(cells),
    startY: y + 18,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: { ...monoStyles(), fontSize: 7, valign: "top" },
    headStyles: { ...monoHead(), fontSize: 7 },
    theme: "grid",
    columnStyles: {
      0: { cellWidth: 72 },
      1: { cellWidth: 150 },
      2: { cellWidth: 48 },
      3: { cellWidth: 62 },
      4: { cellWidth: 36 },
      5: { cellWidth: 44 },
      6: { cellWidth: 52, halign: "right" },
    },
    /* A refused quantity is a sentence, set in red where the figure would be. */
    didParseCell: (d) => {
      if (d.section !== "body") return;
      const raw = String(d.cell.raw ?? "");
      if (d.column.index === 6 && raw && !/^[\d,.—]+$/.test(raw)) {
        d.cell.styles.textColor = [150, 30, 30];
        d.cell.styles.halign = "left";
      }
    },
  });
  if (rows.length === 0) {
    doc.setFontSize(7.5);
    doc.text("No trims on this Material BOM.", M, finalY(doc, y + 18) + 12);
  }

  signOffFooter(doc);
  stampTopPageNumbers(doc, printedY);
  if (header) pageFooter(doc, header, { pageNumbers: false });
  finishPdf(doc, `${stem(data)}.pdf`, output, tab);
}

/** The same grid as CSV (the Excel button) — the printout's eight columns,
 *  the category repeated on every row so a filter in Excel still works. */
export function accessoriesCsv(data: RequirementSheetData): string {
  const out: string[][] = [[...ACCESSORY_COLUMNS]];
  let category = "";
  for (const r of accessoryRows(data.rows, data.names)) {
    if (r.category != null) category = r.category;
    out.push([
      category,
      r.item,
      r.colour ?? "",
      r.spec ?? "",
      r.uom,
      r.size ?? "",
      r.qty == null ? (r.refusal ?? "") : r.qty.toFixed(3),
      r.consumption,
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
