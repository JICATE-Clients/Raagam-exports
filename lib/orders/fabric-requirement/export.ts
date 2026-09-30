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
 * ## THE SHEET FORMAT, PRINT-SAFE BY CONSTRUCTION
 *
 * User 2026-09-29: "this is okay apply it" — the approved sheet format: the
 * masthead (mark, company, kind, RE No large), the order's facts as a grid
 * beside the style picture, the tiles purchasing came for, then each section
 * as a CARD in its tone (the fabric table in the app's blue, YARN PURCHASE in
 * the yarn stage's amber, FABRIC PURCHASE in greige or dyed) with light-ruled
 * tables — drawn with `lib/orders/report-pdf-kit.ts`, the kit every order sheet
 * draws with, and the same blocks the screen renders. This file USED to be handed a mono theme ("a
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
  CONTINUED_TOP,
  STAGE_STYLES,
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
  rgb,
  roomFor,
  type StageStyle,
} from "@/lib/orders/report-pdf-kit";
import { signOffFooter } from "@/lib/orders/fabric-bom/reports-export";
import { fmtDate, fmtNumber } from "@/lib/format";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fabricConsumptionLabel,
  fabricRequirementSummary,
  fabricRequirementTiles,
  fabricSheetQty,
  type FabricSheetRow,
  type FabricSheetTile,
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
  /** The order facts the sheet format's grid prints (2026-09-29) — the same
   *  ones the screen shows. Absent → a dash, never a guess. */
  orderDate?: string | null;
  deliveryDate?: string | null;
  bomDate?: string | null;
  plannedPcs?: number | null;
  excessPct?: number | null;
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

  /* THE MASTHEAD (sheet format, 2026-09-29) — mark or logo, company, the
     document's kind in spaced blue capitals and the RE No large. */
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: meta.company,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Fabric Requirement",
    reNo: meta.scNo,
    meta: [meta.docNo, meta.computedAt ? `Stored ${meta.computedAt}` : null].filter(Boolean).join(" · "),
    margin: M,
  });

  /* THE ORDER'S FACTS as a grid, the style picture (2026-09-26) at its left. */
  const THUMB = 86;
  let thumbW = 0;
  if (thumb) {
    const { w, h } = fitLogo(thumb, THUMB - 4, THUMB - 4);
    doc.setDrawColor(200);
    doc.setLineWidth(0.4);
    doc.rect(M, y, THUMB, THUMB);
    doc.addImage(thumb.dataUrl, "PNG", M + (THUMB - w) / 2, y + (THUMB - h) / 2, w, h);
    doc.setDrawColor(0);
    thumbW = THUMB;
  }
  const date = (v: string | null | undefined) => (v ? fmtDate(v) : null);
  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: meta.customer },
      { label: "Order No", value: meta.orderNo },
      { label: "Order Date", value: date(meta.orderDate) },
      { label: "Delivery Date", value: date(meta.deliveryDate) },
      { label: "BOM Date", value: date(meta.bomDate) },
      {
        label: "Planned",
        value: meta.plannedPcs == null ? null : `${fmtNumber(meta.plannedPcs)} pcs`,
        sub: meta.excessPct == null ? null : `Buyer excess ${meta.excessPct}%`,
      },
    ],
    { margin: M, cols: 3, thumbWidth: thumbW },
  );
  /* THE DERIVATION, STATED ONCE — the opposite of the Accessories sheet on
     purpose: fabric buys the rejection allowance, a trim does not. */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(74, 85, 99);
  doc.text("Rejection allowance is bought here — a garment cut and scrapped has already eaten its cloth.", M, y + 4);
  doc.setTextColor(0);
  y += 16;

  /* THE TILES — what purchasing came for (`fabricRequirementTiles`, which the
     screen reads too). Left out where a figure has no single answer. */
  const toneOfTile: Record<FabricSheetTile["tone"], StageStyle> = {
    brand: BRAND,
    yarn: STAGE_STYLES.yarn,
    greige: STAGE_STYLES.greige,
    dyed: STAGE_STYLES.dyed,
  };
  const tiles = fabricRequirementTiles(rows, yarns, cloth);
  if (tiles.length) {
    y = drawSheetLabel(doc, M, y + 6, "To buy for this order");
    y = drawSummaryTiles(
      doc,
      y,
      tiles.map((t) => ({
        label: t.label,
        value: fmtNumber(Number(t.qty.toFixed(3))),
        unit: t.unit ?? undefined,
        note: t.note,
        tone: toneOfTile[t.tone],
      })),
      M,
    );
  }

  /* THE FABRIC TABLE AS A CARD — the app's blue (a fabric sheet spans every
     stage its cloths pass through, so no one stage owns it), carrying the same
     count the screen's card does. Titled "Fabric Requirement": the rolls BOUGHT
     finished are the separate "Fabric Purchase" card below, and two cards of
     one name read as a repeat (2026-09-29). */
  const { body, bandAt, styleAt, totalAt } = matrix(rows);
  const bands = new Set(bandAt);
  const styleBands = new Set(styleAt);
  const totals = new Set(totalAt);
  const summary = fabricRequirementSummary(rows);
  const mainStart = drawCardHeader(
    doc,
    M,
    roomFor(doc, y + 4, 90, 40),
    W,
    BRAND,
    "Fabric Requirement",
    `${summary.entries} entr${summary.entries === 1 ? "y" : "ies"} · ${summary.styles} style${summary.styles === 1 ? "" : "s"} · ${summary.slices} slice${summary.slices === 1 ? "" : "s"}` +
      (summary.refused ? ` · ${summary.refused} unplanned` : ""),
  );

  autoTable(doc, {
    head: [COLUMNS],
    body,
    startY: mainStart,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles: { 4: { halign: "right" }, 7: { halign: "right" } },
    didParseCell: (d) => {
      /* A figure's heading sits over the figure — `columnStyles` never reach the head. */
      if (d.section === "head" && (d.column.index === 4 || d.column.index === 7)) d.cell.styles.halign = "right";
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
    const startY = drawCardHeader(
      doc,
      M,
      roomFor(doc, lastY(doc, y) + 14, 80, 40),
      W,
      tone,
      "Yarn Purchase",
      `${yarns.length} yarn${yarns.length === 1 ? "" : "s"}`,
    );
    autoTable(doc, {
      head: [["Yarn", "UOM", "Purchase Qty"]],
      body: matrix(yarns).body.map((r) => [r[0], r[6], r[7]]),
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      theme: "plain",
      columnStyles: { 2: { halign: "right" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index === 2) d.cell.styles.halign = "right";
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
    const startY = drawCardHeader(
      doc,
      M,
      roomFor(doc, lastY(doc, y) + 14, 80, 40),
      W,
      tone,
      "Fabric Purchase",
      `${cloth.length} line${cloth.length === 1 ? "" : "s"}`,
    );
    autoTable(doc, {
      head: [["Fabric", "Buying", "Colour", "UOM", "Net Wt", "Purchase Wt"]],
      body: clothBody,
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      theme: "plain",
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
      didParseCell: (d) => {
        if (d.section === "head" && (d.column.index === 4 || d.column.index === 5)) d.cell.styles.halign = "right";
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

  /* PREPARED / CHECKED / APPROVED — the sheet format signs off, as the screen
     does. On a page of its own when the last table ran into the sign-off band. */
  if (lastY(doc, y) > doc.internal.pageSize.getHeight() - 70) doc.addPage();
  signOffFooter(doc);

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
