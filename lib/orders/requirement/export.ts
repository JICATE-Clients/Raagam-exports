/**
 * Downloading the Accessories Requirement — PDF and Excel.
 *
 * Browser-only: both use blob downloads, so call from a `"use client"` island.
 *
 * ## THE PDF IS INK-SAFE BY CONSTRUCTION, NOT BY STRIPPING COLOUR
 *
 * `jspdf-autotable` draws its own table and is handed a mono theme here, so
 * there is no colour in the file to remove. That matters more than it sounds:
 * the alternative — screenshotting the colour view, or re-styling it at export
 * time — gives a file that can DRIFT from the print stylesheet, and the drift
 * only shows up on a supplier's desk. The rule the design turns on is that the
 * medium decides; this is the medium deciding.
 *
 * ## IT PRINTS THE STORED FIGURES, NOT A RECOMPUTE
 *
 * It is handed the same `SheetRow[]` the on-screen document renders, so the
 * paper, the screen and the purchase order cannot disagree. See `sheet.ts`.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { sheetQty, type SheetRow } from "./sheet";

export type SheetMeta = {
  company: string;
  address: string | null;
  gstin: string | null;
  docNo: string | null;
  customer: string | null;
  scNo: string | null;
  orderNo: string | null;
  computedAt: string | null;
};

/** A filesystem-safe stem: `Requirement_HO-RE-2627-0001`. */
function stem(meta: SheetMeta): string {
  const key = (meta.scNo || meta.docNo || "sheet").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Requirement_${key}`;
}

/** The table body, flattened from the document's own rows. */
function matrix(rows: readonly SheetRow[]): { body: string[][]; groupAt: number[] } {
  const body: string[][] = [];
  const groupAt: number[] = [];
  for (const r of rows) {
    if (r.kind === "category") {
      groupAt.push(body.length);
      body.push([r.label, "", "", "", "", ""]);
    } else if (r.kind === "item") {
      body.push([
        r.spec ? `${r.head} — ${r.spec}` : r.head,
        r.colour ?? "",
        r.uom,
        "",
        r.split ? "per size" : (r.refusal ?? sheetQty(r.qty, r.decimals)),
        r.consumption,
      ]);
    } else if (r.kind === "size") {
      body.push(["", "", "", r.size, r.refusal ?? sheetQty(r.qty, r.decimals), r.consumption]);
    } else {
      body.push([r.label, "", "", "", sheetQty(r.qty, r.decimals), ""]);
    }
  }
  return { body, groupAt };
}

export function exportRequirementPdf(rows: readonly SheetRow[], meta: SheetMeta): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const M = 36;
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(meta.company, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  if (meta.address) doc.text(meta.address, M, (y += 12));
  if (meta.gstin) doc.text(`GSTIN ${meta.gstin}`, M, (y += 10));

  // The document's own name, right-aligned against the letterhead.
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ACCESSORIES REQUIREMENT", 559, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (meta.docNo) doc.text(meta.docNo, 559, 58, { align: "right" });

  y += 18;
  doc.setFontSize(9);
  const facts = [
    meta.customer ? `Customer: ${meta.customer}` : null,
    meta.scNo ? `SC No: ${meta.scNo}` : null,
    meta.orderNo ? `Order No: ${meta.orderNo}` : null,
  ].filter(Boolean) as string[];
  if (facts.length) doc.text(facts.join("    "), M, y);

  const { body, groupAt } = matrix(rows);
  const groups = new Set(groupAt);

  autoTable(doc, {
    head: [["Item", "Colour", "UOM", "Size", "Qty", "Consumption"]],
    body,
    startY: y + 10,
    margin: { left: M, right: M },
    styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    /* MONO, NOT BRANDED. `lib/reports/export-pdf.ts` fills its head with brand
       indigo, which is right for a screen-first report and wrong for a document
       a supplier prints on a mono laser: a saturated band turns to mud and
       costs colour toner on every page. Grey reads correctly on both. */
    headStyles: { fillColor: [235, 237, 240], textColor: 20, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: { 4: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      // A category band and a total row carry weight instead of colour.
      if (groups.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [255, 255, 255];
      }
      const first = String(d.row.cells[0]?.raw ?? "");
      if (first.includes("— total")) d.cell.styles.fontStyle = "bold";
    },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(
      meta.computedAt ? `Requirement stored ${meta.computedAt}` : "",
      M,
      doc.internal.pageSize.getHeight() - 20,
    );
    doc.text(`Page ${p} / ${pages}`, 559, doc.internal.pageSize.getHeight() - 20, {
      align: "right",
    });
  }

  doc.save(`${stem(meta)}.pdf`);
}

/**
 * Excel, as a flat list rather than the document's shape.
 *
 * A purchase team filters and sorts this; a grouping band and an indented size
 * row are document furniture that become empty cells in a spreadsheet. So each
 * row carries its own category and item — repetition that is wrong on paper and
 * right in a filter.
 */
export function requirementCsv(rows: readonly SheetRow[]): string {
  const out: string[][] = [["Category", "Item", "Spec", "Colour", "UOM", "Size", "Qty", "Consumption"]];
  let category = "";
  let head = "";
  let spec = "";
  let colour = "";
  let uom = "";
  for (const r of rows) {
    if (r.kind === "category") {
      category = r.label;
    } else if (r.kind === "item") {
      head = r.head;
      spec = r.spec ?? "";
      colour = r.colour ?? "";
      uom = r.uom;
      if (!r.split) {
        out.push([category, head, spec, colour, uom, "", sheetQty(r.qty, r.decimals), r.consumption]);
      }
    } else if (r.kind === "size") {
      out.push([category, head, spec, colour, uom, r.size, sheetQty(r.qty, r.decimals), r.consumption]);
    }
    // A total row is DROPPED: a spreadsheet sums its own column, and a stored
    // total sitting among the rows would be double-counted by anyone who does.
  }
  return out
    .map((line) => line.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function exportRequirementCsv(rows: readonly SheetRow[], meta: SheetMeta): void {
  // The BOM prefix keeps Excel from reading a leading `=` or `+` as a formula.
  const blob = new Blob(["﻿" + requirementCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(meta)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
