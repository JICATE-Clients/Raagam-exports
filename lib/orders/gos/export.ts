/**
 * Garment Order Sheet — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`, canvas), so call from a
 * `"use client"` island. Handed the SAME `GosSheet` the page renders, so the
 * page, the paper and the spreadsheet cannot disagree.
 *
 * The order documents' frame (client 2026-09-23: "follow our new format") —
 * green rule, logo, company + registered address, blue title — with the RE
 * Number printed large under the title: 500+ people track work by it, and a
 * sheet found face-down on a table has to be identifiable from arm's length.
 *
 * THE SHEET FORMAT (user 2026-09-29: "this is okay apply it" — the approved
 * "Raagam Requirement Sheet" design, which the client asked for in "our style"
 * rather than the RP printout copied line for line): the kit's masthead with
 * the RE Number large, the order's facts as a grid beside the style picture,
 * summary tiles, and every section a card — tone header with its headline
 * figure, a clean table, tinted totals, swatches. Every fact and figure the
 * sheet printed before is still here. Pale tints under dark ink, so a mono
 * print still reads.
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { swatchFor } from "@/lib/orders/fabric-bom/report-colours";
import {
  BRAND,
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
  type StageStyle,
} from "@/lib/orders/report-pdf-kit";
import type { ReportStyleImages } from "./style-images";
import { pickReportThumbnail, withoutThumbnail } from "./report-thumbnail";
import { isRefusal, type GosSheet, type GosStyle } from "./types";
import type { DocLetterhead } from "./letterhead";
import {
  CONSTRUCTION_ONLY,
  DASH,
  gosColourText,
  gosGsmText,
  gosHeaderColumns,
  gosHeaderFacts,
  gosStyleFacts,
  gosSummary,
  gosStyleTitle,
  txt,
} from "./format";

export type PdfOutput = "download" | "print";

/** A section that is a WARNING (quantities no style took) — the screen's red
 *  box, as a bar. */
const DANGER: StageStyle = { label: "", tint: "#fdf3f2", rule: "#b3261e", ink: "#b3261e" };

function stem(s: GosSheet): string {
  const key = (s.header.reNumber || "order").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Garment-Order-Sheet_${key}`;
}

const num = (v: number | null) => (v === null ? DASH : fmtNumber(v));

function matrixBody(style: GosStyle): { head: string[]; body: RowInput[]; foot: string[] } | null {
  if (isRefusal(style.matrix)) return null;
  const m = style.matrix;
  return {
    head: ["Colour", ...m.columns.map((c) => c.label), "Total"],
    body: m.rows.map((r) => [`${r.combo}${r.undeclared ? " (not on Combos)" : ""}`, ...r.cells.map(num), fmtNumber(r.total)]),
    foot: ["Total", ...m.columnTotals.map((t) => fmtNumber(t)), fmtNumber(m.total)],
  };
}

function componentBody(style: GosStyle): { head: string[]; body: RowInput[] } | null {
  if (style.coordinates.length === 0) return null;
  const cols = 3 + style.colourways.length;
  const body: RowInput[] = [];
  for (const block of style.coordinates) {
    body.push([{ content: block.coordinate.toUpperCase(), colSpan: cols, styles: { fontStyle: "bold", fillColor: rgb(BRAND.tint), textColor: rgb(BRAND.ink) } }]);
    for (const p of block.panels) {
      const row: CellInput[] = [txt(p.component), txt(p.structure), gosGsmText(p), ...p.colours.map(gosColourText)];
      body.push(row);
    }
  }
  return { head: ["Component", "Structure", "GSM", ...style.colourways], body };
}

export async function exportGosPdf(
  sheet: GosSheet,
  company: DocLetterhead,
  images: ReportStyleImages | { failed: string },
  output: PdfOutput = "download",
): Promise<void> {
  /* THE TAB OPENS BEFORE ANY AWAIT — a popup opened after one is no longer
     "in response to the click" and the browser blocks it. */
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 30;
  const CW = W - 2 * M;
  const h = sheet.header;

  /* THE MASTHEAD (the sheet format, user 2026-09-29) — company, the document's
     name, and the RE Number large: 500+ people track work by it, and a sheet
     found face-down on a table has to be identifiable from arm's length. A
     confirmed order carries a green "Confirmed"; a draft says so in red below. */
  const logo = await loadLetterheadImage(company.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: company.name,
    unit: company.unit,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Garment Order Sheet",
    reNo: txt(h.reNumber),
    meta: h.isDraft ? null : `Printed ${fmtDateTime(sheet.printedAt)}`,
    status: h.isDraft ? null : "Confirmed",
    margin: M,
  });
  if (h.isDraft) {
    // A DRAFT IS NOT A DIRECTIVE — said in words, in red, not as a watermark.
    const label = "DRAFT — NOT CONFIRMED";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const w = doc.getTextWidth(label) + 10;
    doc.setDrawColor(179, 38, 30);
    doc.setLineWidth(0.8);
    doc.rect(W - M - w, y - 8, w, 11, "S");
    doc.setTextColor(179, 38, 30);
    doc.text(label, W - M - w / 2, y - 0.5, { align: "center" });
    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    y += 8;
  }

  /* THE HEADER THUMBNAIL (2026-09-26) — the picture the page shows beside the
     facts (`pickReportThumbnail`), fitted into an 86 pt square; the facts move
     right by its width only when it drew. A picture that will not load draws
     nothing, and the sheet still prints. */
  const thumbSrc = pickReportThumbnail(images, sheet.styles.length === 1 ? sheet.styles[0].styleRef : null);
  const thumb = thumbSrc ? await loadLetterheadImage(thumbSrc.url) : null;
  const THUMB = 86;
  if (thumb) {
    const { w, h: th } = fitLogo(thumb, THUMB - 4, THUMB - 4);
    doc.setDrawColor(221, 226, 232);
    doc.setLineWidth(0.6);
    doc.roundedRect(M, y, THUMB, THUMB, 3, 3, "S");
    doc.addImage(thumb.dataUrl, "PNG", M + (THUMB - w) / 2, y + (THUMB - th) / 2, w, th);
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
  }
  y = drawOrderFacts(doc, y, gosHeaderFacts(sheet), { margin: M, cols: 4, thumbWidth: thumb ? THUMB : 0 });

  // THE FIGURES THE SHEET IS PICKED UP FOR.
  y = drawSheetLabel(doc, M, y + 6, "This order");
  y = drawSummaryTiles(
    doc,
    y,
    gosSummary(sheet).map((t) => ({ ...t, tone: BRAND })),
    M,
  );

  /* THE CURSOR — where the next block starts. Every autoTable moves it, and so
     does every block drawn by hand (images, facts), so a heading always lands
     under whatever came last. */
  let cursor = y;
  const tableEnd = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const table = {
    margin: { left: M, right: M, top: 40 },
    theme: "plain" as const,
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    footStyles: { fillColor: rgb(BRAND.tint), textColor: rgb(BRAND.ink), fontStyle: "bold" as const },
  };
  /** Stripe a table's body rows. */
  const striped = () => ({
    didParseCell: (d: Parameters<typeof paintRow>[0]) => paintRow(d, { tone: BRAND }),
  });
  /** A SECTION CARD'S HEADER, kept on the page with room for its table. `right`
   *  is the section's headline figure. Returns the table's startY. */
  const card = (title: string, gap = 12, right?: string | null, tone: StageStyle = BRAND, rightLabel?: string | null) => {
    let top = cursor + gap;
    if (top > H - 110) {
      doc.addPage();
      top = 40;
    }
    return drawCardHeader(doc, M, top, CW, tone, title, right ?? null, rightLabel ?? null);
  };

  /* The thumbnailed picture does not print again below. */
  const rest = withoutThumbnail(images, thumb ? thumbSrc : null);
  const groups = "failed" in rest ? [] : rest;
  const styleRefs = new Set(sheet.styles.map((st) => st.styleRef?.trim()).filter(Boolean));
  const imagesOf = (ref: string | null | undefined) =>
    groups.find((g) => g.styleRef != null && g.styleRef === ref?.trim())?.images ?? [];

  /** A strip of pictures, 4 across, each fitted into a 110 x 100 pt box, under
   *  its own card header. */
  const drawImages = async (urls: string[], title: string) => {
    if (urls.length === 0) return;
    const loaded = (await Promise.all(urls.map((u) => loadLetterheadImage(u)))).filter((i) => i != null);
    let iy = card(title) + 6;
    if (loaded.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text("(pictures could not be loaded into the PDF — see the sheet on screen)", M + 6, iy + 6);
      doc.setTextColor(0);
      cursor = iy + 10;
      return;
    }
    const boxW = 110;
    const boxH = 100;
    if (iy + boxH > H - 50) {
      doc.addPage();
      iy = 40;
    }
    let cx = M;
    for (const img of loaded) {
      if (cx + boxW > W - M) {
        cx = M;
        iy += boxH + 6;
        if (iy + boxH > H - 50) {
          doc.addPage();
          iy = 40;
        }
      }
      const { w, h: ih } = fitLogo(img, boxW - 6, boxH - 6);
      doc.setDrawColor(221, 226, 232);
      doc.setLineWidth(0.6);
      doc.roundedRect(cx, iy, boxW, boxH, 3, 3, "S");
      doc.addImage(img.dataUrl, "PNG", cx + (boxW - w) / 2, iy + (boxH - ih) / 2, w, ih);
      cx += boxW + 6;
    }
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    cursor = iy + boxH + 2;
  };

  for (const g of groups.filter((g) => g.styleRef == null || !styleRefs.has(g.styleRef))) {
    await drawImages(
      g.images.map((i) => i.url),
      g.styleRef == null ? "Order images" : `Style images · ${g.styleRef}`,
    );
  }

  // DESTINATIONS — only when the order ships to more than one.
  if (sheet.destinations.length > 1) {
    autoTable(doc, {
      ...table,
      head: [["Destination", "Customer PO", "Delivery", "Earlier shipment", "Qty"]],
      body: sheet.destinations.map((d) => [txt(d.label), txt(d.poNo), fmtDate(d.deliveryDate), fmtDate(d.earlierShipmentDate), fmtNumber(d.qty)]),
      startY: card("Destinations", 12, `${fmtNumber(sheet.destinations.reduce((a, d) => a + (d.qty ?? 0), 0))} pcs`),
      columnStyles: { 4: { halign: "right" } },
      ...striped(),
    });
    cursor = tableEnd();
  }

  for (const style of sheet.styles) {
    /* THE STYLE AS A CARD — its STL code and name, PO Qty at the right, then
       its facts as a grid; the break-up and the components follow as their
       own cards. Kept together with room for at least its facts. */
    if (cursor + 150 > H - 50) {
      doc.addPage();
      cursor = 28;
    }
    const facts = gosStyleFacts(style).map(([label, value]) => ({ label, value }));
    let sy = drawCardHeader(doc, M, cursor + 16, CW, BRAND, gosStyleTitle(style), fmtNumber(style.poQty), "PO Qty");
    sy = drawOrderFacts(doc, sy, facts, { margin: M + 6, cols: 5 });
    if (style.coordinateWarning) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(179, 38, 30);
      const lines = doc.splitTextToSize(style.coordinateWarning, CW - 12) as string[];
      doc.text(lines, M + 6, sy + 4);
      doc.setTextColor(0);
      doc.setFont("helvetica", "normal");
      sy += 6 + lines.length * 9;
    }
    cursor = sy;

    await drawImages(imagesOf(style.styleRef).map((i) => i.url), "Style images");

    const mx = matrixBody(style);
    const my = card(
      "Size-wise and colour-wise break-up",
      10,
      isRefusal(style.matrix) ? null : `${fmtNumber(style.matrix.total)} pcs`,
    );
    if (mx && !isRefusal(style.matrix)) {
      const numeric: Record<number, { halign: "right" }> = {};
      for (let i = 1; i < mx.head.length; i++) numeric[i] = { halign: "right" };
      const combos = style.matrix.rows.map((r) => r.combo);
      autoTable(doc, {
        ...table,
        head: [mx.head],
        body: mx.body,
        foot: [mx.foot],
        startY: my,
        columnStyles: numeric,
        showFoot: "lastPage",
        /* Striped, with the colourway's swatch beside its name. */
        didParseCell: (d) => {
          paintRow(d, { tone: BRAND });
          /* `columnStyles` reaches body rows only — the size heads and the
             Total row would sit left of the right-aligned figures under them. */
          if (d.section !== "body" && d.column.index >= 1) d.cell.styles.halign = "right";
          if (d.section === "body" && d.column.index === 0 && swatchFor(combos[d.row.index])) {
            d.cell.styles.cellPadding = SWATCH_PADDING;
          }
        },
        didDrawCell: (d) => {
          if (d.section !== "body" || d.column.index !== 0) return;
          const hex = swatchFor(combos[d.row.index]);
          if (hex) drawSwatch(doc, d.cell, hex);
        },
      });
    } else {
      autoTable(doc, {
        ...table,
        body: [[isRefusal(style.matrix) ? style.matrix.refused : ""]],
        startY: my,
        styles: { ...table.styles, fontStyle: "bold", textColor: [179, 38, 30] },
      });
    }
    cursor = tableEnd();

    const cb = componentBody(style);
    const cy = card("Components", 10);
    if (cb) {
      /* Row index -> the panel it prints (banner rows map to null), so the
         colour cells carry their swatch and the banners keep their tint. */
      const panelAt: (GosStyle["coordinates"][number]["panels"][number] | null)[] = [];
      for (const block of style.coordinates) {
        panelAt.push(null);
        for (const p of block.panels) panelAt.push(p);
      }
      const colourOf = (row: number, col: number) => {
        const p = panelAt[row];
        return p && col >= 3 ? (p.colours[col - 3]?.colour ?? null) : null;
      };
      autoTable(doc, {
        ...table,
        head: [cb.head],
        body: cb.body,
        startY: cy,
        columnStyles: { 2: { halign: "right" } },
        didParseCell: (d) => {
          if (d.section === "head" && d.column.index === 2) d.cell.styles.halign = "right";
          if (d.section === "body" && panelAt[d.row.index] === null) return;
          paintRow(d, { tone: BRAND });
          if (d.section === "body" && swatchFor(colourOf(d.row.index, d.column.index))) {
            d.cell.styles.cellPadding = SWATCH_PADDING;
          }
        },
        didDrawCell: (d) => {
          if (d.section !== "body") return;
          const hex = swatchFor(colourOf(d.row.index, d.column.index));
          if (hex) drawSwatch(doc, d.cell, hex);
        },
      });
    } else {
      autoTable(doc, {
        ...table,
        body: [["No components are declared for this style — the Combos tab has no structure detail."]],
        startY: cy,
        styles: { ...table.styles, fontStyle: "bold", textColor: [179, 38, 30] },
      });
    }
    cursor = tableEnd();
  }

  // PIECES THAT LANDED NOWHERE ARE PRINTED, NOT DROPPED.
  if (sheet.orphans.length > 0) {
    autoTable(doc, {
      ...table,
      head: [["Style (not declared)", "Colour", "Qty"]],
      body: sheet.orphans.map((o) => [o.ref, o.combo, fmtNumber(o.qty)]),
      startY: card(
        "Quantities not shown above — correct the order before cutting",
        16,
        `${fmtNumber(sheet.orphans.reduce((a, o) => a + o.qty, 0))} pcs`,
        DANGER,
      ),
      columnStyles: { 2: { halign: "right" } },
    });
    cursor = tableEnd();
  }

  // THE FOOT — order total, the construction-only line, the signatures.
  let fy = cursor + 18;
  if (fy > H - 110) {
    doc.addPage();
    fy = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(23, 32, 43);
  doc.text(
    `Order total ${fmtNumber(sheet.grandTotal)} pcs · ${sheet.styles.length} style${sheet.styles.length === 1 ? "" : "s"}`,
    M,
    fy,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(123, 133, 148);
  doc.text(CONSTRUCTION_ONLY, M, fy + 12, { maxWidth: CW });

  // Prepared / Checked / Approved, each over its own rule (the sheet format).
  const sy = fy + 64;
  const colW = (CW - 2 * 24) / 3;
  doc.setDrawColor(23, 32, 43);
  doc.setLineWidth(0.6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(23, 32, 43);
  ["Prepared By", "Checked By", "Approved By"].forEach((label, i) => {
    const x = M + i * (colW + 24);
    doc.line(x, sy, x + colW, sy);
    doc.text(label, x, sy + 10);
  });

  const printed = `Printed ${fmtDateTime(sheet.printedAt)}`;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(221, 226, 232);
    doc.setLineWidth(0.5);
    doc.line(M, H - 28, W - M, H - 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(123, 133, 148);
    doc.text(`${txt(h.reNumber)}  ·  Garment Order Sheet  ·  ${printed}`, M, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: "right" });
  }

  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  // A blocked print tab falls back to the download.
  doc.save(`${stem(sheet)}.pdf`);
}

/** Excel as a CSV — header facts, then each style's break-up and components. */
export function exportGosCsv(sheet: GosSheet): void {
  const lines: string[][] = [["Garment Order Sheet", txt(sheet.header.reNumber)], []];
  for (const col of gosHeaderColumns(sheet)) for (const [k, v] of col) lines.push([k, v]);
  if (sheet.destinations.length > 1) {
    lines.push([], ["Destination", "Customer PO", "Delivery", "Earlier shipment", "Qty"]);
    for (const d of sheet.destinations) lines.push([txt(d.label), txt(d.poNo), fmtDate(d.deliveryDate), fmtDate(d.earlierShipmentDate), String(d.qty)]);
  }
  for (const style of sheet.styles) {
    lines.push([], [gosStyleTitle(style), `PO Qty ${style.poQty}`], ...gosStyleFacts(style).map(([k, v]) => [k, v]));
    if (isRefusal(style.matrix)) {
      lines.push([style.matrix.refused]);
    } else {
      const m = style.matrix;
      /* Bare digits — a grouped "1,200" is a string to Excel and would not sum. */
      lines.push([], ["Colour", ...m.columns.map((c) => c.label), "Total"]);
      for (const r of m.rows) lines.push([r.combo, ...r.cells.map((v) => (v === null ? DASH : String(v))), String(r.total)]);
      lines.push(["Total", ...m.columnTotals.map(String), String(m.total)]);
    }
    if (style.coordinates.length) {
      lines.push([], ["Component", "Structure", "GSM", ...style.colourways]);
      for (const block of style.coordinates) {
        lines.push([block.coordinate]);
        for (const p of block.panels) lines.push([txt(p.component), txt(p.structure), gosGsmText(p), ...p.colours.map((c) => gosColourText(c).replace("\n", " / "))]);
      }
    }
  }
  if (sheet.orphans.length) {
    lines.push([], ["Quantities not shown above"], ["Style (not declared)", "Colour", "Qty"]);
    for (const o of sheet.orphans) lines.push([o.ref, o.combo, String(o.qty)]);
  }
  lines.push([], ["Order total", String(sheet.grandTotal)], [CONSTRUCTION_ONLY]);

  const csv = lines
    .map((line) => line.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
    .join("\n");
  // The BOM prefix keeps Excel reading UTF-8 and not a leading `=` as a formula.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(sheet)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
