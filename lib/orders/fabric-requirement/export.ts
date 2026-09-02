/**
 * Downloading the Fabric Requirement — PDF and Excel.
 *
 * Browser-only: both use blob downloads, so call from a `"use client"` island.
 *
 * ## LANDSCAPE, WHERE THE ACCESSORIES SHEET IS PORTRAIT
 *
 * Not a style choice. This table carries the derivation — pieces, consumption,
 * wastage — beside the quantity, because a knitter checks the figure rather than
 * trusting it. Eight columns on A4 portrait wraps the fabric name to three lines
 * and the sheet stops being scannable.
 *
 * ## THE PDF IS INK-SAFE BY CONSTRUCTION, NOT BY STRIPPING COLOUR
 *
 * `jspdf-autotable` draws its own table and is handed a mono theme here, so
 * there is no colour in the file to remove. The alternative — screenshotting the
 * colour view, or re-styling it at export time — gives a file that can DRIFT
 * from the print stylesheet, and the drift only shows up on a supplier's desk.
 *
 * ## IT PRINTS THE STORED FIGURES, NOT A RECOMPUTE
 *
 * It is handed the same `FabricSheetRow[]` the on-screen document renders, so
 * the paper, the screen and the purchase order cannot disagree. See `sheet.ts`.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fabricConsumptionLabel,
  fabricSheetQty,
  type FabricSheetRow,
} from "./sheet";

export type FabricSheetMeta = {
  company: string;
  address: string | null;
  gstin: string | null;
  docNo: string | null;
  customer: string | null;
  scNo: string | null;
  orderNo: string | null;
  computedAt: string | null;
};

/** A filesystem-safe stem: `FabricRequirement_HO-RE-2627-0001`. */
function stem(meta: FabricSheetMeta): string {
  const key = (meta.scNo || meta.docNo || "sheet")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `FabricRequirement_${key}`;
}

const COLUMNS = [
  "Style / Fabric",
  "Structure",
  "Components",
  "Colour · Size",
  "Pcs",
  "Consumption",
  "UOM",
  "Qty",
];

/** The table body, flattened from the document's own rows. */
function matrix(rows: readonly FabricSheetRow[]): { body: string[][]; bandAt: number[] } {
  const body: string[][] = [];
  const bandAt: number[] = [];

  for (const r of rows) {
    if (r.kind === "style") {
      bandAt.push(body.length);
      body.push([r.label, "", "", "", "", "", "", ""]);
    } else if (r.kind === "entry") {
      bandAt.push(body.length);
      body.push([r.fabric, r.structure ?? "", r.components ?? "", "", "", "", r.uom, ""]);
    } else if (r.kind === "slice") {
      body.push([
        "",
        "",
        "",
        r.slice,
        r.pieces == null ? "" : String(r.pieces),
        /* NO UNIT IN THIS CELL — the entry header above the slice already
           carries the UOM, and the table has a column for it. Repeating it here
           would make the PDF read differently from the screen document, which is
           the drift the two are written side by side to avoid. */
        fabricConsumptionLabel(r.consumption, r.wastagePct, null, r.decimals),
        "",
        r.refusal ?? fabricSheetQty(r.qty, r.decimals),
      ]);
    } else if (r.kind === "total") {
      body.push([r.label, "", "", "", "", "", r.uom, fabricSheetQty(r.qty, r.decimals)]);
    } else {
      body.push([r.yarn, "", "", "", "", "", r.uom, r.refusal ?? fabricSheetQty(r.qty, r.decimals)]);
    }
  }
  return { body, bandAt };
}

export function exportFabricRequirementPdf(
  rows: readonly FabricSheetRow[],
  yarns: readonly FabricSheetRow[],
  meta: FabricSheetMeta,
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
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
  doc.text("FABRIC REQUIREMENT", RIGHT, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (meta.docNo) doc.text(meta.docNo, RIGHT, 58, { align: "right" });

  y += 18;
  doc.setFontSize(9);
  const facts = [
    meta.customer ? `Customer: ${meta.customer}` : null,
    meta.scNo ? `SC No: ${meta.scNo}` : null,
    meta.orderNo ? `Order No: ${meta.orderNo}` : null,
  ].filter(Boolean) as string[];
  if (facts.length) doc.text(facts.join("    "), M, y);

  const { body, bandAt } = matrix(rows);
  const bands = new Set(bandAt);

  autoTable(doc, {
    head: [COLUMNS],
    body,
    startY: y + 10,
    margin: { left: M, right: M },
    styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    /* MONO, NOT BRANDED — the same call `lib/orders/requirement/export.ts`
       records: a saturated head band turns to mud on a mono laser and costs
       colour toner on every page of a document a supplier prints. */
    headStyles: { fillColor: [235, 237, 240], textColor: 20, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: { 4: { halign: "right" }, 7: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      // A style band and an entry header carry weight instead of colour.
      if (bands.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [255, 255, 255];
      }
      const first = String(d.row.cells[0]?.raw ?? "");
      if (first.includes("— total")) d.cell.styles.fontStyle = "bold";
    },
  });

  /* THE YARN SECTION IS A SECOND TABLE, not more rows of the first. Its
     quantities are in a DIFFERENT unit and answer a different purchase — a
     spinner's order, not a knitter's — so a reader who sums the Qty column must
     not find the two mixed into one run. It is omitted entirely when the BOM
     computed none, which is the honest state for cloth bought finished. */
  if (yarns.length) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    const startY = (after?.finalY ?? y) + 24;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("YARN PURCHASE", M, startY - 8);
    autoTable(doc, {
      head: [["Yarn", "UOM", "Purchase Qty"]],
      body: matrix(yarns).body.map((r) => [r[0], r[6], r[7]]),
      startY,
      margin: { left: M, right: M },
      styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
      headStyles: { fillColor: [235, 237, 240], textColor: 20, fontStyle: "bold" },
      columnStyles: { 2: { halign: "right" } },
    });
  }

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
    doc.text(`Page ${p} / ${pages}`, RIGHT, doc.internal.pageSize.getHeight() - 20, {
      align: "right",
    });
  }

  doc.save(`${stem(meta)}.pdf`);
}

/**
 * Excel, as a flat list rather than the document's shape.
 *
 * Purchasing filters and sorts this; a style band and an indented slice row are
 * document furniture that become empty cells in a spreadsheet. So each row
 * carries its own style, fabric, structure and components — repetition that is
 * wrong on paper and right in a filter.
 *
 * A total row is DROPPED: a spreadsheet sums its own column, and a stored total
 * sitting among the rows would be double-counted by anyone who does.
 *
 * A REFUSAL TRAVELS IN ITS OWN COLUMN rather than in the quantity cell. On paper
 * the sentence replaces the figure, which is right for a reader; in a
 * spreadsheet it would make the Qty column text and every SUM over it return
 * zero — silently, which is the worst way for this particular number to be
 * wrong.
 */
export function fabricRequirementCsv(
  rows: readonly FabricSheetRow[],
  yarns: readonly FabricSheetRow[],
): string {
  const out: string[][] = [
    [
      "Section",
      "Style",
      "Fabric",
      "Structure",
      "Components",
      "Colour · Size",
      "Pcs",
      "Consumption",
      "Wastage %",
      "UOM",
      "Qty",
      "Refusal",
    ],
  ];

  let style = "";
  let fabric = "";
  let structure = "";
  let components = "";
  let uom = "";

  for (const r of rows) {
    if (r.kind === "style") {
      style = r.label;
    } else if (r.kind === "entry") {
      fabric = r.fabric;
      structure = r.structure ?? "";
      components = r.components ?? "";
      uom = r.uom;
    } else if (r.kind === "slice") {
      out.push([
        "Fabric",
        style,
        fabric,
        structure,
        components,
        r.slice,
        r.pieces == null ? "" : String(r.pieces),
        r.consumption == null ? "" : String(r.consumption),
        r.wastagePct == null ? "" : String(r.wastagePct),
        uom,
        r.qty == null ? "" : fabricSheetQty(r.qty, r.decimals),
        r.refusal ?? "",
      ]);
    }
  }

  for (const y of yarns) {
    if (y.kind !== "yarn") continue;
    out.push([
      "Yarn",
      "",
      y.yarn,
      "",
      "",
      "",
      "",
      "",
      "",
      y.uom,
      y.qty == null ? "" : fabricSheetQty(y.qty, y.decimals),
      y.refusal ?? "",
    ]);
  }

  return out
    .map((line) => line.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function exportFabricRequirementCsv(
  rows: readonly FabricSheetRow[],
  yarns: readonly FabricSheetRow[],
  meta: FabricSheetMeta,
): void {
  // The BOM prefix keeps Excel from reading a leading `=` or `+` as a formula.
  const blob = new Blob(["﻿" + fabricRequirementCsv(rows, yarns)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(meta)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
