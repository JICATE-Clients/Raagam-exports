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
