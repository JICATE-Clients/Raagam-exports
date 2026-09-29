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
 * ## THE YARN & FABRIC REQUIREMENT'S LOOK, PRINT-SAFE BY CONSTRUCTION
 *
 * User 2026-09-29: "another reports also need to look like yarn fabric
 * requirement like looking". Every section is a filled bar in its tone (the
 * fabric table in the app's blue, YARN PURCHASE in the yarn stage's amber,
 * FABRIC PURCHASE in greige or dyed), heads tinted to match, rows striped,
 * totals tinted — drawn with `lib/orders/report-pdf-kit.ts`, the kit the Yarn &
 * Fabric Requirement draws with. This file USED to be handed a mono theme ("a
 * saturated head band turns to mud on a mono laser"); the kit's fills are PALE
 * TINTS under near-black ink, not a saturated band, so a supplier's mono laser
 * still separates the sections and no page carries a solid fill.
 * `jspdf-autotable` still draws its own table, so the file cannot drift from a
 * screenshot of the colour view — there is none.
 *
 * ## IT PRINTS THE STORED FIGURES, NOT A RECOMPUTE
 *
 * It is handed the same `FabricSheetRow[]` the on-screen document renders, so
 * the paper, the screen and the purchase order cannot disagree. See `sheet.ts`.
 */
import { drawCadPendingStamp } from "@/lib/orders/cad-lifecycle/stamp";
import { DEFAULT_LETTERHEAD_LOGO, fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  BRAND,
  STAGE_STYLES,
  SWATCH_PADDING,
  drawSectionHeading,
  drawSwatch,
  paintRow,
  rgb,
  roomFor,
  toneHead,
  type StageStyle,
} from "@/lib/orders/report-pdf-kit";
import { fmtNumber } from "@/lib/format";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fabricConsumptionLabel,
  fabricRequirementSummary,
  fabricSheetQty,
  type FabricSheetRow,
} from "./sheet";
/* THE RULE 2 DEMAND LINE (0564) — declared by the report that computes it, so
   the on-screen sheet, this file and the printed report all name one type
   rather than three structurally identical ones. */
import type { ClothPurchaseLine } from "@/lib/orders/fabric-bom/reports";

export type FabricSheetMeta = {
  company: string;
  address: string | null;
  gstin: string | null;
  docNo: string | null;
  customer: string | null;
  scNo: string | null;
  orderNo: string | null;
  computedAt: string | null;
  /** The order's CAD is not yet approved (0628) — stamp every page. */
  cadPending?: boolean;
  /** The header thumbnail (2026-09-26) — the style picture ticked "Print on
   *  reports", signed at render and never frozen (`pickReportThumbnail`).
   *  Absent / null / unloadable → no picture, the layout as before. */
  thumbUrl?: string | null;
  /** The letterhead logo (2026-09-29) — the order documents' frame. Absent →
   *  the default wordmark (`DEFAULT_LETTERHEAD_LOGO`, what `letterheadLogoOf`
   *  answers for an empty Company Profile); null → no logo. */
  logo?: string | null;
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

/** The table body, flattened from the document's own rows — with where the
 *  style bands, entry headers and totals landed, so the table can dress each
 *  kind of row differently from a slice. */
function matrix(rows: readonly FabricSheetRow[]): {
  body: string[][];
  bandAt: number[];
  styleAt: number[];
  totalAt: number[];
} {
  const body: string[][] = [];
  const bandAt: number[] = [];
  const styleAt: number[] = [];
  const totalAt: number[] = [];

  for (const r of rows) {
    if (r.kind === "style") {
      bandAt.push(body.length);
      styleAt.push(body.length);
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
      totalAt.push(body.length);
      body.push([r.label, "", "", "", "", "", r.uom, fabricSheetQty(r.qty, r.decimals)]);
    } else {
      body.push([r.yarn, "", "", "", "", "", r.uom, r.refusal ?? fabricSheetQty(r.qty, r.decimals)]);
    }
  }
  return { body, bandAt, styleAt, totalAt };
}

/** The colour half of a slice label ("WHITE · M" → "WHITE"), for its swatch. */
const sliceColour = (slice: string) => slice.split("·")[0]?.trim() ?? "";

/** A refused quantity is a sentence, set in red where the figure would be. */
const REFUSAL_INK: [number, number, number] = [179, 38, 30];
const isFigure = (v: string) => v === "" || /^[\d,.\-—]+$/.test(v);

/** Where the last table ended — the next section's bar goes below it. */
function lastY(doc: jsPDF, fallback: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;
}

export async function exportFabricRequirementPdf(
  rows: readonly FabricSheetRow[],
  yarns: readonly FabricSheetRow[],
  meta: FabricSheetMeta,
  /** THE RULE 2 DEMAND (0564) — greige or dyed rolls to buy, from the sheet's
   *  own `cloth`. Defaults to none, so every existing call site (and an
   *  all-Rule-1 document, which is every BOM before 2026-09-16) prints the
   *  file it always did. */
  cloth: readonly ClothPurchaseLine[] = [],
): Promise<void> {
  const [thumb, logo] = await Promise.all([
    loadLetterheadImage(meta.thumbUrl ?? null),
    loadLetterheadImage(meta.logo === undefined ? DEFAULT_LETTERHEAD_LOGO : meta.logo),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const M = 36;
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  const W = RIGHT - M;

  /* THE ORDER DOCUMENTS' FRAME (2026-09-29) — green rule, logo, company, blue
     title, dark rule: the letterhead the Garment Order Sheet, the Budget and
     the Fabric BOM reports already wear. This sheet was the one order document
     still printing a bare black name and title. */
  doc.setFillColor(133, 194, 39);
  doc.rect(M, 20, W, 2.5, "F");
  let textX = M;
  let logoBottom = 0;
  if (logo) {
    const { w, h } = fitLogo(logo, 120, 40);
    doc.addImage(logo.dataUrl, "PNG", M, 28, w, h);
    textX = M + w + 12;
    logoBottom = 28 + h;
  }
  let y = 44;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(22, 24, 29);
  doc.text(meta.company, textX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  if (meta.address) {
    const lines = doc.splitTextToSize(meta.address, Math.max(160, RIGHT - textX - 220)) as string[];
    for (const line of lines.slice(0, 3)) doc.text(line, textX, (y += 10));
  }
  if (meta.gstin) doc.text(`GSTIN ${meta.gstin}`, textX, (y += 10));

  // The document's own name, right-aligned against the letterhead, in the app's blue.
  doc.setTextColor(3, 123, 184);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("FABRIC REQUIREMENT", RIGHT, 44, { align: "right" });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (meta.docNo) doc.text(meta.docNo, RIGHT, 56, { align: "right" });

  /* A DARK RULE UNDER THE LETTERHEAD, below whichever is taller. */
  y = Math.max(y, logoBottom, 56) + 8;
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1);
  doc.line(M, y, RIGHT, y);
  doc.setLineWidth(0.4);
  doc.setDrawColor(0);

  y += 14;
  /* THE HEADER THUMBNAIL (2026-09-26) at the facts' top-left, fitted into an
     86 pt square; the facts move right by its width and the table starts below
     whichever is taller. Drawn only when the picture loaded. */
  const THUMB = 86;
  let fx = M;
  let tableTop = y + 10;
  if (thumb) {
    const top = y - 9;
    const { w, h } = fitLogo(thumb, THUMB - 4, THUMB - 4);
    doc.setDrawColor(200);
    doc.setLineWidth(0.4);
    doc.rect(M, top, THUMB, THUMB);
    doc.addImage(thumb.dataUrl, "PNG", M + (THUMB - w) / 2, top + (THUMB - h) / 2, w, h);
    fx = M + THUMB + 8;
    tableTop = Math.max(tableTop, top + THUMB + 8);
  }
  doc.setFontSize(9);
  doc.setTextColor(22, 24, 29);
  const facts = [
    meta.customer ? `Customer: ${meta.customer}` : null,
    meta.scNo ? `SC No: ${meta.scNo}` : null,
    meta.orderNo ? `Order No: ${meta.orderNo}` : null,
  ].filter(Boolean) as string[];
  if (facts.length) doc.text(facts.join("    "), fx, y);

  /* THE FABRIC TABLE — a bar in the app's blue (a fabric sheet spans every
     stage its cloths pass through, so no one stage owns it), carrying the same
     count the on-screen band does. */
  const { body, bandAt, styleAt, totalAt } = matrix(rows);
  const bands = new Set(bandAt);
  const styleBands = new Set(styleAt);
  const totals = new Set(totalAt);
  const summary = fabricRequirementSummary(rows);
  const mainStart = drawSectionHeading(
    doc,
    M,
    tableTop + 10,
    W,
    BRAND,
    "FABRIC PURCHASE",
    `${summary.entries} entr${summary.entries === 1 ? "y" : "ies"} · ${summary.styles} style${summary.styles === 1 ? "" : "s"} · ${summary.slices} slice${summary.slices === 1 ? "" : "s"}` +
      (summary.refused ? ` · ${summary.refused} unplanned` : ""),
  );

  autoTable(doc, {
    head: [COLUMNS],
    body,
    startY: mainStart,
    margin: { left: M, right: M },
    styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
    headStyles: toneHead(BRAND),
    columnStyles: { 4: { halign: "right" }, 7: { halign: "right" } },
    didParseCell: (d) => {
      paintRow(d, { tone: BRAND, totals });
      if (d.section !== "body") return;
      /* A STYLE BAND in the section's tint; an ENTRY header bold on white —
         the two headings the slices beneath them belong to. */
      if (styleBands.has(d.row.index)) {
        d.cell.styles.fillColor = rgb(BRAND.tint);
        d.cell.styles.textColor = rgb(BRAND.ink);
        d.cell.styles.fontStyle = "bold";
      } else if (bands.has(d.row.index)) {
        d.cell.styles.fillColor = [255, 255, 255];
        d.cell.styles.fontStyle = "bold";
      }
      const raw = String(d.cell.raw ?? "");
      if (d.column.index === 3 && swatchFor(sliceColour(raw))) d.cell.styles.cellPadding = SWATCH_PADDING;
      if (d.column.index === 7 && !isFigure(raw)) {
        d.cell.styles.textColor = REFUSAL_INK;
        d.cell.styles.halign = "left";
      }
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 3) return;
      const hex = swatchFor(sliceColour(String(d.cell.raw ?? "")));
      if (hex) drawSwatch(doc, d.cell, hex);
    },
  });

  /* THE YARN SECTION IS A SECOND TABLE, not more rows of the first. Its
     quantities are in a DIFFERENT unit and answer a different purchase — a
     spinner's order, not a knitter's — so a reader who sums the Qty column must
     not find the two mixed into one run. It is omitted entirely when the BOM
     computed none, which is the honest state for cloth bought finished. */
  if (yarns.length) {
    const tone = STAGE_STYLES.yarn;
    const startY = drawSectionHeading(
      doc,
      M,
      roomFor(doc, lastY(doc, y), 80, 40) + 22,
      W,
      tone,
      "YARN PURCHASE",
      `${yarns.length} yarn${yarns.length === 1 ? "" : "s"}`,
    );
    autoTable(doc, {
      head: [["Yarn", "UOM", "Purchase Qty"]],
      body: matrix(yarns).body.map((r) => [r[0], r[6], r[7]]),
      startY,
      margin: { left: M, right: M },
      styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
      headStyles: toneHead(tone),
      columnStyles: { 2: { halign: "right" } },
      didParseCell: (d) => {
        paintRow(d, { tone });
        if (d.section === "body" && d.column.index === 2 && !isFigure(String(d.cell.raw ?? ""))) {
          d.cell.styles.textColor = REFUSAL_INK;
          d.cell.styles.halign = "left";
        }
      },
    });
  }

  /* FABRIC PURCHASE (0564) — A THIRD TABLE, for the YARN PURCHASE table's own
     reason one step along: these quantities answer a different purchase again
     (a cloth merchant's order, not a spinner's), and a reader who sums a Qty
     column must not find rolls mixed into cones. Omitted entirely on an
     all-Rule-1 document, like the yarn table above it. */
  if (cloth.length) {
    /* GREIGE OR DYED ROLLS — the section wears the stage its rolls are bought
       in (Dyed only when every line is a dyed purchase), and each line's
       `Buying` cell wears its own. */
    const toneOf = (l: ClothPurchaseLine): StageStyle =>
      l.source === "dyed_purchase" ? STAGE_STYLES.dyed : STAGE_STYLES.greige;
    const tone = cloth.every((l) => l.source === "dyed_purchase") ? STAGE_STYLES.dyed : STAGE_STYLES.greige;
    /* A TOTAL ONLY WHERE THERE IS ONE — the screen's rule: one unit across
       every line or no total row at all, never kilograms added to metres. */
    const units = new Set(cloth.map((l) => l.uomCode ?? ""));
    const total = units.size === 1 ? cloth.reduce((a, l) => a + l.purchaseWt, 0) : null;
    const clothBody = cloth.map((l) => [
      l.component ? `${l.fabricName} · ${l.component}` : l.fabricName,
      l.label,
      l.combo ?? "",
      l.uomCode ?? "",
      fmtNumber(l.netWt),
      fmtNumber(l.purchaseWt),
    ]);
    const totalRow = total == null ? -1 : clothBody.length;
    if (total != null) {
      const uom = [...units][0];
      clothBody.push([`Total Fabric Purchase Requirement${uom ? ` (${uom})` : ""}`, "", "", "", "", fmtNumber(total)]);
    }
    const startY = drawSectionHeading(
      doc,
      M,
      roomFor(doc, lastY(doc, y), 80, 40) + 22,
      W,
      tone,
      "FABRIC PURCHASE",
      `${cloth.length} line${cloth.length === 1 ? "" : "s"}`,
    );
    autoTable(doc, {
      head: [["Fabric", "Buying", "Colour", "UOM", "Net Wt", "Purchase Wt"]],
      body: clothBody,
      startY,
      margin: { left: M, right: M },
      styles: { fontSize: 7.5, cellPadding: 3, textColor: 20, lineColor: 200, lineWidth: 0.4 },
      headStyles: toneHead(tone),
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
      didParseCell: (d) => {
        paintRow(d, { tone, totals: new Set([totalRow]) });
        if (d.section !== "body" || d.row.index === totalRow) return;
        const line = cloth[d.row.index];
        if (d.column.index === 1 && line) {
          d.cell.styles.fillColor = rgb(toneOf(line).tint);
          d.cell.styles.textColor = rgb(toneOf(line).ink);
          d.cell.styles.fontStyle = "bold";
        }
        if (d.column.index === 2 && swatchFor(line?.combo)) d.cell.styles.cellPadding = SWATCH_PADDING;
      },
      didDrawCell: (d) => {
        if (d.section !== "body" || d.column.index !== 2 || d.row.index === totalRow) return;
        const hex = swatchFor(cloth[d.row.index]?.combo);
        if (hex) drawSwatch(doc, d.cell, hex);
      },
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
    // CAD PENDING (0628) on every page — see lib/orders/cad-lifecycle/stamp.ts.
    if (meta.cadPending) drawCadPendingStamp(doc);
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
  /** See `exportFabricRequirementPdf`'s own note (0564). */
  cloth: readonly ClothPurchaseLine[] = [],
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

  /* FABRIC PURCHASE (0564) — the rows that REPLACE the yarn above for a cloth
     this order does not knit. In the same sheet and keyed by a different first
     column, the way the Yarn rows already are: a spreadsheet that split them
     into tabs would let a reader total one and believe they had the demand.
     The `Buying` word goes in the slice column so greige and dyed rolls stay
     tellable apart after the file leaves this app. */
  for (const l of cloth) {
    out.push([
      "Fabric Purchase",
      "",
      l.component ? `${l.fabricName} · ${l.component}` : l.fabricName,
      "",
      l.label,
      l.combo ?? "",
      "",
      String(l.netWt),
      "",
      l.uomCode ?? "",
      String(l.purchaseWt),
      "",
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
  /** See `exportFabricRequirementPdf`'s own note (0564). */
  cloth: readonly ClothPurchaseLine[] = [],
): void {
  // The BOM prefix keeps Excel from reading a leading `=` or `+` as a formula.
  const blob = new Blob(["﻿" + fabricRequirementCsv(rows, yarns, cloth)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(meta)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
