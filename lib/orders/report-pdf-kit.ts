/**
 * THE ORDER REPORTS' ONE PDF LOOK (user 2026-09-29: "another reports also need
 * to look like yarn fabric requirement like looking").
 *
 * The Yarn & Fabric Requirement was the only document ever given a design
 * (client design A, 2026-09-20; the screen's look carried into the PDF,
 * 2026-09-29) — and every piece of it lived as a private helper inside
 * `fabric-bom/reports-export.ts`, where no other exporter could reach it. So
 * the Garment Order Sheet, the Cutting Chart, the Budget and the rest each
 * drew their own plain tables, and the one designed report stood alone. The
 * same lesson AGENTS.md records for screens: a look fixed in one file leaves
 * every other copy behind. It lives here now, and every exporter draws with it.
 *
 * WHAT A SECTION LOOKS LIKE, in every order report:
 *   - a FILLED BAR in the section's tone — a strong rule across its top, the
 *     tag (when the section has a stage) and the title in the tone's ink, and
 *     the section's headline figure at the right (`drawSectionHeading`);
 *   - the table's head in the same tint (`toneHead`), rows striped
 *     (`paintRow`), and total rows tinted and bold;
 *   - GREY / DYED / GREIGE words as badges, garment colours as swatches.
 *
 * THE TONE ALWAYS SAYS SOMETHING (`report-colours.ts`'s rule): a section about
 * a production stage wears that stage (`STAGE_STYLES`); anything else — an
 * order's facts, a budget's costs — wears `BRAND`, the app's blue, and carries
 * no tag, because a tag with nothing to say would be decoration.
 *
 * PRINT-SAFE: every fill is a pale tint under near-black ink, so a mono laser
 * (the Accessories Requirement's supplier) still separates the sections.
 *
 * Client-safe: jsPDF runs in the browser.
 */
import type { jsPDF } from "jspdf";
import { STAGE_STRIPE, STAGE_STYLES, rgb, type StageStyle } from "@/lib/orders/fabric-bom/report-colours";

export { STAGE_STYLES, rgb, type StageStyle };

/** THE APP'S BLUE, for a section that is not about a stage. `label: ""` —
 *  such a section's bar carries no tag. */
export const BRAND: StageStyle = { label: "", tint: "#eaf7fd", rule: "#037bb8", ink: "#024f78" };

/** WHERE A CONTINUED TABLE RESUMES on a later page of a portrait report —
 *  below the `Page : n/m` stamp at y = 62, which a table resuming at
 *  autoTable's default margin printed straight over. */
export const CONTINUED_TOP = 72;

/** The alternate body row — the screen's `even:` stripe, one step darker
 *  because the screen's `#fafbfc` vanishes on paper. */
export const ROW_STRIPE = "#f4f6f9";

/** The four-stage stripe across the top of a document — yarn, greige, dyed,
 *  print, left to right: the order the cloth moves in. */
export function drawStageStripe(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  const seg = w / STAGE_STRIPE.length;
  STAGE_STRIPE.forEach((c, i) => {
    doc.setFillColor(...rgb(c));
    doc.rect(x + i * seg, y, seg, h, "F");
  });
}

/** A stage tag — pale fill, strong border, dark ink. Returns its width (0 for
 *  a tone with no label, which draws nothing). */
export function drawStageTag(doc: jsPDF, x: number, baselineY: number, st: StageStyle): number {
  if (!st.label) return 0;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  const w = doc.getTextWidth(st.label) + 8;
  doc.setFillColor(...rgb(st.tint));
  doc.setDrawColor(...rgb(st.rule));
  doc.setLineWidth(0.6);
  doc.roundedRect(x, baselineY - 7, w, 9.5, 1.5, 1.5, "FD");
  doc.setTextColor(...rgb(st.ink));
  doc.text(st.label, x + 4, baselineY);
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  return w;
}

/**
 * A SECTION HEADING — the screen's bar. A band in the tone's tint with its
 * rule across the top, the tag (if the tone has one) and the title in the
 * tone's ink, and `right` — the section's headline figure — at the right.
 *
 * `y` is the title's BASELINE; the band runs from 10pt above it to 5pt below,
 * and the table starts flush under the band. Returns the table's startY.
 */
export function drawSectionHeading(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  st: StageStyle,
  title: string,
  right?: string,
): number {
  const top = y - 10;
  const bottom = y + 5;
  doc.setFillColor(...rgb(st.tint));
  doc.rect(x, top, width, bottom - top, "F");
  doc.setFillColor(...rgb(st.rule));
  doc.rect(x, top, width, 2, "F");
  const tagW = drawStageTag(doc, x + 5, y, st);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...rgb(st.ink));
  doc.text(title, x + 5 + (tagW ? tagW + 5 : 0), y);
  if (right) doc.text(right, x + width - 5, y, { align: "right" });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return bottom;
}

/** A plain heading over a run of sections — the screen's pale-blue band with
 *  brand-blue capitals ("PROCESS STAGE LEDGER"). Returns the next baseline. */
export function drawGroupHeading(doc: jsPDF, x: number, y: number, width: number, title: string): number {
  doc.setFillColor(234, 247, 253);
  doc.rect(x, y - 9, width, 13, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(3, 123, 184);
  doc.text(title, x + 5, y);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return y + 4;
}

/**
 * KEEP A HEADING WITH ITS TABLE. With less than `need` points left above the
 * sign-off band, start a new page — a heading alone at the foot of a page, its
 * rows overleaf, reads as a section with no rows. The returned `y` is the one
 * a caller draws its heading at `y + 14` from: the band's top then sits at
 * CONTINUED_TOP, clear of the `Page : n/m` stamp.
 */
export function roomFor(doc: jsPDF, y: number, need: number, footerBand = 60): number {
  if (y + need <= doc.internal.pageSize.getHeight() - footerBand) return y;
  doc.addPage();
  return CONTINUED_TOP - 4;
}

/** A table head in the tone's tint and ink — what makes a table read as its
 *  bar's own. Spread into autoTable's `headStyles`. */
export function toneHead(st: StageStyle) {
  return {
    fillColor: rgb(st.tint),
    textColor: rgb(st.ink),
    fontStyle: "bold" as const,
    fontSize: 6.5,
  };
}

/**
 * THE BODY ROW'S LOOK, for autoTable's `didParseCell`: stripe every other row,
 * and tint + embolden the rows in `totals` in the section's tone. Call it
 * FIRST in a `didParseCell`, so a report's own per-cell colour (a red refusal,
 * a swatch's padding) paints over it.
 */
export function paintRow(
  d: {
    section: string;
    row: { index: number };
    cell: { styles: { fillColor?: unknown; fontStyle?: unknown; textColor?: unknown } };
  },
  opts: { tone: StageStyle; totals?: ReadonlySet<number>; stripe?: boolean },
): void {
  if (d.section !== "body") return;
  if (opts.stripe !== false && d.row.index % 2 === 1) d.cell.styles.fillColor = rgb(ROW_STRIPE);
  if (opts.totals?.has(d.row.index)) {
    d.cell.styles.fillColor = rgb(opts.tone.tint);
    d.cell.styles.textColor = rgb(opts.tone.ink);
    d.cell.styles.fontStyle = "bold";
  }
}

/**
 * THE STAGE-STATE BADGE — GREY / GREIGE / DYED / RFD in a state column, the
 * screen's `StageBadge`: the word on a rounded fill of its stage. Clear the
 * cell's text in `didParseCell` (`if (STATE_BADGE[word]) d.cell.text = []`)
 * and draw it in `didDrawCell`. An unknown word keeps its plain text.
 */
export const STATE_BADGE: Record<string, { fill: string; ink: string }> = {
  GREY: { fill: STAGE_STYLES.greige.tint, ink: STAGE_STYLES.greige.ink },
  GREIGE: { fill: STAGE_STYLES.greige.tint, ink: STAGE_STYLES.greige.ink },
  DYED: { fill: STAGE_STYLES.dyed.tint, ink: STAGE_STYLES.dyed.ink },
  WASH: { fill: STAGE_STYLES.wash.tint, ink: STAGE_STYLES.wash.ink },
  PRINT: { fill: STAGE_STYLES.print.tint, ink: STAGE_STYLES.print.ink },
  RFD: { fill: "#fde8cc", ink: "#8a5a15" },
};
export function drawStateBadge(doc: jsPDF, cell: { x: number; y: number; height: number }, word: string): void {
  const look = STATE_BADGE[word];
  if (!look) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  const w = doc.getTextWidth(word) + 7;
  const h = 8.5;
  const bx = cell.x + 3;
  const by = cell.y + (cell.height - h) / 2;
  doc.setFillColor(...rgb(look.fill));
  doc.roundedRect(bx, by, w, h, 1.5, 1.5, "F");
  doc.setTextColor(...rgb(look.ink));
  doc.text(word, bx + 3.5, by + 6.1);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
}

/** A colourway swatch at the left of a table cell. Widen the cell's left
 *  padding with `SWATCH_PADDING` in `didParseCell` to make room. */
export function drawSwatch(doc: jsPDF, cell: { x: number; y: number; height: number }, hex: string): void {
  const size = 6;
  doc.setFillColor(...rgb(hex));
  doc.setDrawColor(110, 116, 128);
  doc.setLineWidth(0.5);
  /* ON THE FIRST TEXT LINE — a cell that wraps to two lines would otherwise
     put the swatch beside the second. */
  doc.rect(cell.x + 3, cell.y + 3.5, size, size, "FD");
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
}
export const SWATCH_PADDING = { top: 3, right: 3, bottom: 3, left: 12 };

/* ===========================================================================
 * THE SHEET FORMAT, PRINTED (user 2026-09-29: "this is okay apply it" — the
 * approved "Raagam Requirement Sheet" / "Raagam Budget Statement" mockups).
 * The PDF twin of the screen kit's SheetMasthead · OrderFacts · QtyEquation ·
 * SummaryTiles · RouteStrip · SectionCard, block for block, so the page and
 * the printout are one document. Portrait A4 in points; every function takes
 * the Y to start at and returns the Y below what it drew.
 * ========================================================================= */

const INK: [number, number, number] = [23, 32, 43];
const INK_2: [number, number, number] = [74, 85, 99];
const INK_3: [number, number, number] = [123, 133, 148];
const LINE: [number, number, number] = [221, 226, 232];
const LINE_2: [number, number, number] = [238, 241, 244];
const BLUE: [number, number, number] = [3, 123, 184];
const GREEN: [number, number, number] = [133, 194, 39];

function spaced(doc: jsPDF, text: string, x: number, y: number, spacing: number, align: "left" | "right" = "left") {
  /* jsPDF has no letter-spacing: set it through the char-space operator. The
     width grows by (n-1) × spacing, which a right-aligned caller corrects for. */
  const w = doc.getTextWidth(text) + Math.max(0, text.length - 1) * spacing;
  const sx = align === "right" ? x - w : x;
  doc.setCharSpace(spacing);
  doc.text(text, sx, y);
  doc.setCharSpace(0);
  return w;
}

export type SheetLogo = { dataUrl: string; w: number; h: number } | null;

/**
 * THE MASTHEAD — four-stage stripe; the logo (or the Raagam mark: a blue
 * square, its initial, a green corner); company and unit; at the right the
 * document kind in spaced blue capitals, the RE No large, and a meta line with
 * an optional green status pill. A dark rule closes it.
 */
export function drawSheetMasthead(
  doc: jsPDF,
  opts: {
    company: string | null;
    unit?: string | null;
    logo?: SheetLogo;
    kind: string;
    reNo: string | null;
    meta?: string | null;
    status?: string | null;
    margin?: number;
  },
): number {
  const M = opts.margin ?? 28;
  const W = doc.internal.pageSize.getWidth();
  const R = W - M;
  drawStageStripe(doc, M, 14, R - M, 4);

  const top = 28;
  let textX = M;
  if (opts.logo) {
    const scale = Math.min(96 / opts.logo.w, 32 / opts.logo.h, 1);
    const w = opts.logo.w * scale;
    const h = opts.logo.h * scale;
    doc.addImage(opts.logo.dataUrl, "PNG", M, top, w, h);
    textX = M + w + 10;
  } else {
    doc.setFillColor(...BLUE);
    doc.roundedRect(M, top, 30, 30, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text((opts.company ?? "R").trim().charAt(0).toUpperCase(), M + 15, top + 20.5, { align: "center" });
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M + 22, top + 22, 10, 10, 2, 2, "F");
    doc.setFillColor(...GREEN);
    doc.roundedRect(M + 23.5, top + 23.5, 7, 7, 1.5, 1.5, "F");
    textX = M + 40;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text((opts.company ?? "RAAGAM EXPORTS").toUpperCase(), textX, top + 13);
  if (opts.unit) {
    doc.setFontSize(6.8);
    doc.setTextColor(...INK_3);
    spaced(doc, opts.unit.toUpperCase(), textX, top + 23, 0.5);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...BLUE);
  spaced(doc, opts.kind.toUpperCase(), R, top + 7, 1.1, "right");
  if (opts.reNo) {
    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(opts.reNo, R, top + 22, { align: "right" });
  }
  let metaX = R;
  if (opts.status) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    const pw = doc.getTextWidth(opts.status) + 16;
    doc.setFillColor(238, 247, 223);
    doc.roundedRect(R - pw, top + 26, pw, 10, 5, 5, "F");
    doc.setFillColor(...GREEN);
    doc.circle(R - pw + 6, top + 31, 1.6, "F");
    doc.setTextColor(63, 106, 13);
    doc.text(opts.status, R - pw + 10, top + 33.3);
    metaX = R - pw - 5;
  }
  if (opts.meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...INK_3);
    doc.text(opts.meta, metaX, top + 33.3, { align: "right" });
  }
  const ruleY = top + 42;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1.2);
  doc.line(M, ruleY, R, ruleY);
  doc.setLineWidth(0.4);
  doc.setDrawColor(0);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return ruleY + 10;
}

/** A small spaced-capitals caption over a block. Returns the next Y. */
export function drawSheetLabel(doc: jsPDF, x: number, y: number, text: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.setTextColor(...INK_2);
  spaced(doc, text.toUpperCase(), x, y, 1);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return y + 6;
}

export type PdfFact = { label: string; value: string | null | undefined; sub?: string | null };

/**
 * THE ORDER'S FACTS — a grid of label / value (/ grey sub-line), `cols` wide,
 * the style picture at its left when there is one (`thumb`, drawn by the
 * caller's own `drawThumbnail`-style function and passed as its width).
 */
export function drawOrderFacts(
  doc: jsPDF,
  y: number,
  facts: readonly PdfFact[],
  opts: { margin?: number; cols?: number; thumbWidth?: number } = {},
): number {
  const M = opts.margin ?? 28;
  const W = doc.internal.pageSize.getWidth();
  const x0 = M + (opts.thumbWidth ? opts.thumbWidth + 12 : 0);
  const cols = opts.cols ?? 3;
  const colW = (W - M - x0) / cols;
  let rowY = y + 8;
  for (let i = 0; i < facts.length; i += cols) {
    const row = facts.slice(i, i + cols);
    const hasSub = row.some((f) => !!f.sub);
    row.forEach((f, j) => {
      const x = x0 + j * colW;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(...INK_3);
      spaced(doc, f.label.toUpperCase(), x, rowY, 0.5);
      doc.setFontSize(8.6);
      doc.setTextColor(...INK);
      const v = doc.splitTextToSize(f.value && String(f.value).trim() ? String(f.value) : "—", colW - 8) as string[];
      doc.text(v[0] ?? "—", x, rowY + 10.5);
      if (f.sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.6);
        doc.setTextColor(...INK_3);
        doc.text(String(f.sub), x, rowY + 18.5);
      }
    });
    rowY += hasSub ? 28 : 22;
  }
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return Math.max(rowY, y + (opts.thumbWidth ?? 0) + 4) + 2;
}

export type PdfQtyTerm = { label: string; value: string; note?: string | null };

/** Order + Excess + Approval + Rej.Allow = Cut, drawn as the sum it is. */
export function drawQtyEquation(
  doc: jsPDF,
  y: number,
  terms: readonly PdfQtyTerm[],
  result: PdfQtyTerm,
  margin = 28,
): number {
  const M = margin;
  const W = doc.internal.pageSize.getWidth() - 2 * M;
  const H = 34;
  const OP = 12;
  const cells = terms.length + 1;
  const cellW = (W - OP * terms.length) / cells;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, y, W, H, 4, 4, "S");
  let x = M;
  const cell = (t: PdfQtyTerm, filled: boolean) => {
    if (filled) {
      doc.setFillColor(...BLUE);
      doc.roundedRect(x, y, cellW, H, 4, 4, "F");
      doc.rect(x, y, 6, H, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...(filled ? ([207, 230, 244] as [number, number, number]) : INK_3));
    spaced(doc, t.label.toUpperCase(), x + 8, y + 10, 0.5);
    doc.setFont("courier", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...(filled ? ([255, 255, 255] as [number, number, number]) : INK));
    doc.text(t.value, x + 8, y + 22);
    if (t.note) {
      doc.setFont("courier", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...(filled ? ([207, 230, 244] as [number, number, number]) : INK_3));
      doc.text(t.note, x + 8, y + 30);
    }
    x += cellW;
  };
  const op = (sign: string) => {
    doc.setFillColor(247, 249, 251);
    doc.rect(x, y + 0.3, OP, H - 0.6, "F");
    doc.setDrawColor(...LINE_2);
    doc.line(x, y, x, y + H);
    doc.line(x + OP, y, x + OP, y + H);
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK_3);
    doc.text(sign, x + OP / 2, y + H / 2 + 3, { align: "center" });
    x += OP;
  };
  terms.forEach((t, i) => {
    if (i > 0) op("+");
    cell(t, false);
  });
  op("=");
  cell(result, true);
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.setFont("helvetica", "normal");
  return y + H + 12;
}

export type PdfTile = { label: string; value: string; unit?: string | null; note?: string | null; tone?: StageStyle };

/** The figures the reader came for — tiles ruled on top in their tone, up to four a row. */
export function drawSummaryTiles(doc: jsPDF, y: number, tiles: readonly PdfTile[], margin = 28): number {
  const M = margin;
  const W = doc.internal.pageSize.getWidth() - 2 * M;
  const perRow = Math.min(4, Math.max(1, tiles.length));
  const GAP = 8;
  const tw = (W - GAP * (perRow - 1)) / perRow;
  /* Room for a two-line note — a fabric name is often longer than a tile. */
  const H = 50;
  tiles.forEach((t, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = M + col * (tw + GAP);
    const ty = y + row * (H + GAP);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, ty, tw, H, 3, 3, "S");
    doc.setFillColor(...rgb((t.tone ?? BRAND).rule));
    doc.roundedRect(x, ty, tw, 2.6, 1.3, 1.3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(...INK_2);
    doc.text(t.label, x + 7, ty + 12);
    doc.setFont("courier", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(t.value, x + 7, ty + 25);
    if (t.unit) {
      const vw = doc.getTextWidth(t.value);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...INK_3);
      doc.text(t.unit, x + 7 + vw + 3, ty + 25);
    }
    if (t.note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(...INK_3);
      const n = doc.splitTextToSize(t.note, tw - 12) as string[];
      doc.text(n.slice(0, 2), x + 7, ty + 35);
    }
  });
  const rows = Math.ceil(tiles.length / perRow);
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.setFont("helvetica", "normal");
  return y + rows * H + (rows - 1) * GAP + 12;
}

/** The order's stages in sequence — numbered chips in their stage tone, wrapping. */
export function drawRouteStrip(
  doc: jsPDF,
  y: number,
  steps: readonly { label: string; tone: StageStyle }[],
  margin = 28,
): number {
  const M = margin;
  const R = doc.internal.pageSize.getWidth() - M;
  let x = M;
  let cy = y;
  const H = 13;
  steps.forEach((s, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    const w = doc.getTextWidth(s.label) + 22;
    const arrowW = i > 0 ? 12 : 0;
    if (x + arrowW + w > R) {
      x = M;
      cy += H + 5;
    } else if (i > 0) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...INK_3);
      doc.text("›", x + 4, cy + 9.2);
      x += arrowW;
    }
    doc.setFillColor(...rgb(s.tone.tint));
    doc.roundedRect(x, cy, w, H, 6.5, 6.5, "F");
    doc.setFillColor(...rgb(s.tone.rule));
    doc.circle(x + 6.8, cy + H / 2, 4.6, "F");
    doc.setFont("courier", "bold");
    doc.setFontSize(6);
    doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), x + 6.8, cy + H / 2 + 2, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(...rgb(s.tone.ink));
    doc.text(s.label, x + 14.5, cy + 9.2);
    x += w;
  });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return cy + H + 12;
}

/**
 * A SECTION CARD'S HEADER — a rounded band in the tone's tint: the tag (when
 * the tone has a label), the title in the tone's ink, and the section's figure
 * at the right (`rightLabel` small before it). The table is drawn flush
 * beneath it by the caller. `y` is the band's TOP; returns the table's startY.
 */
export function drawCardHeader(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  st: StageStyle,
  title: string,
  right?: string | null,
  rightLabel?: string | null,
): number {
  const H = 19;
  doc.setFillColor(...rgb(st.tint));
  doc.roundedRect(x, y, width, H, 4, 4, "F");
  doc.rect(x, y + H - 5, width, 5, "F");
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(x, y + H, x + width, y + H);
  let tx = x + 7;
  if (st.label) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    const tw = doc.getTextWidth(st.label) + 7;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...rgb(st.rule));
    doc.setLineWidth(0.6);
    doc.roundedRect(tx, y + 5, tw, 9, 1.5, 1.5, "FD");
    doc.setTextColor(...rgb(st.ink));
    doc.text(st.label, tx + 3.5, y + 11.4);
    tx += tw + 6;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor(...rgb(st.ink));
  doc.text(title, tx, y + 12.4);
  if (right) {
    doc.setFont("courier", "bold");
    doc.setFontSize(8.2);
    doc.text(right, x + width - 7, y + 12.4, { align: "right" });
    if (rightLabel) {
      const rw = doc.getTextWidth(right);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.text(rightLabel, x + width - 7 - rw - 5, y + 12.4, { align: "right" });
    }
  }
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.setFont("helvetica", "normal");
  return y + H;
}

/** The body style every card's table uses — light rules, no heavy grid. */
export function cardTableStyles() {
  return {
    fontSize: 7.2,
    cellPadding: { top: 3.2, right: 5, bottom: 3.2, left: 5 },
    textColor: INK,
    lineColor: LINE_2,
    lineWidth: { bottom: 0.5, top: 0, left: 0, right: 0 },
  };
}
/** Its head: small spaced grey capitals on white, ruled underneath. */
export function cardTableHead() {
  return {
    fillColor: [255, 255, 255] as [number, number, number],
    textColor: INK_3,
    fontStyle: "bold" as const,
    fontSize: 6,
    lineColor: LINE,
    lineWidth: { bottom: 0.6, top: 0, left: 0, right: 0 },
  };
}
