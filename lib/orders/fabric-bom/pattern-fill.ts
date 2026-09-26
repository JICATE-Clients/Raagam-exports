/**
 * Fabric BOM ▸ Manual FILLED FROM THE PATTERN SHEET (user 2026-09-26; spec
 * "Pattern Sheet ➔ Fabric BOM Manual Tab").
 *
 * The Pattern Sheet (0640 · 0643 · 0644 · 0647) and a Manual entry hold the
 * same thing — which panels are cut from which cloth, the roll form, the
 * colourways, and a Dia and gram weight per size. What carries across is the
 * user's list, and only that: Type of Parts, Colour, Size, Table Dia,
 * Tubular / Open Width, Avg CAD Pcs Wt (g). The Pattern Sheet's FABRIC is a
 * structure, used to find the entry; its GSM has no Manual field (Manual reads
 * GSM off the order, 2026-09-04) and does not carry. Shrinkage does not carry.
 *
 * ONE MATCH PER PATTERN LINE. Manual already lists an entry per (style,
 * fabric, roll form) on its own, so a pattern line FILLS that entry rather
 * than standing a second copy beside it: same style, same structure, and a
 * roll form that agrees (or is not stated on one side). Among several, the one
 * sharing the most panels wins. A line with no entry to fill becomes a new one.
 *
 * TWO MODES, AND THE DIFFERENCE IS THE MERCHANDISER'S WORK:
 *   fill    on opening — fills only entries Manual already lists, and only
 *           while no gram weight is typed on them (that is the merchandiser's
 *           own work). Never ADDS: on a new BOM the fabrics are named after
 *           opening, and Manual lists an entry per fabric by itself — an entry
 *           added here first would stand beside that one as a duplicate.
 *   resync  the button — every matched entry takes the sheet's figures, and a
 *           line with no entry to fill becomes a new one.
 * Neither ever removes an entry.
 *
 * PURE. The screen owns the entry rows; this only decides which pattern line
 * lands where.
 */

import type { ManualPanel } from "./manual";

export type PatternFillSize = { size_id: string; table_dia: number | null; avg_pcs_weight_g: number | null };

/** One Pattern Sheet line, as the Fabric BOM reads it. */
export type PatternFillLine = {
  style_ref_no: string;
  /** The line's FABRIC — a structure (`categories` row), matched to the entry's. */
  fabric_category_id: string | null;
  width_form: "open_width" | "tubular" | null;
  parts: ManualPanel[];
  colours: string[];
  /** 0647: false = `table_dia` / `avg_pcs_weight_g` answer every size. */
  size_wise: boolean;
  table_dia: number | null;
  avg_pcs_weight_g: number | null;
  sizes: PatternFillSize[];
};

/** What the matcher needs of a Manual entry. */
export type PatternFillEntry = {
  key: string;
  style_ref_no: string;
  structure_id: string | null;
  width_form: string;
  panels: ManualPanel[];
  /** Any gram weight typed on any size — the merchandiser's own work. */
  hasWeights: boolean;
};

export type PatternFillPlan = {
  /** Pattern line → the entry it fills. */
  fills: { entryKey: string; line: PatternFillLine }[];
  /** Pattern lines with no entry to fill — the screen adds one each. */
  additions: PatternFillLine[];
  /** Lines left alone because their entry already holds the merchandiser's weights (fill mode). */
  kept: number;
};

const norm = (s: string) => s.trim().toUpperCase();
const panelKey = (p: ManualPanel) => `${p.coordinate_id ?? ""}|${p.component_id}`;

/** Does this line say anything worth carrying? A line of parts alone is not a measurement. */
export const lineHasFigures = (l: PatternFillLine) =>
  l.size_wise
    ? l.sizes.some((z) => z.table_dia != null || z.avg_pcs_weight_g != null)
    : l.table_dia != null || l.avg_pcs_weight_g != null;

export function planPatternFill(
  lines: readonly PatternFillLine[],
  entries: readonly PatternFillEntry[],
  mode: "fill" | "resync",
  /** Whether an entry's style is this line's — the screen's own rule
   *  (`entriesForStyle`: a blank style on a single-style order is that style). */
  sameStyle: (entryStyle: string, lineStyle: string) => boolean = (a, b) => norm(a) === norm(b),
): PatternFillPlan {
  const used = new Set<string>();
  const plan: PatternFillPlan = { fills: [], additions: [], kept: 0 };
  for (const line of lines) {
    if (!lineHasFigures(line)) continue;
    const parts = new Set(line.parts.map(panelKey));
    let best: PatternFillEntry | null = null;
    let bestOverlap = -1;
    for (const e of entries) {
      if (used.has(e.key)) continue;
      if (!sameStyle(e.style_ref_no, line.style_ref_no)) continue;
      if (!line.fabric_category_id || e.structure_id !== line.fabric_category_id) continue;
      if (e.width_form && line.width_form && e.width_form !== line.width_form) continue;
      const overlap = e.panels.filter((p) => parts.has(panelKey(p))).length;
      if (overlap > bestOverlap) {
        best = e;
        bestOverlap = overlap;
      }
    }
    if (!best) {
      if (mode === "resync") plan.additions.push(line);
      continue;
    }
    used.add(best.key);
    if (mode === "fill" && best.hasWeights) {
      plan.kept += 1;
      continue;
    }
    plan.fills.push({ entryKey: best.key, line });
  }
  return plan;
}
