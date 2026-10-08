/**
 * Consumption as a SIZE-GROUP MATRIX (UX plan P2.1, 2026-10-07): components
 * down, size groups across, grams in the cells.
 *
 * THE MATRIX IS A VIEW; THE ROWS ARE THE TRUTH. Storage, the server's checks,
 * `calc.ts` and both PDFs keep reading `WeightDraft` rows — one per component
 * × size group — exactly as before, so no migration and no second arithmetic.
 * This file is the two-way bridge, and it is pure so `check:sample-costing`
 * can pin it.
 *
 * INHERITANCE. A cell left blank takes the FIRST column's grams: a rib that is
 * 40 g in every size range is typed once (the spec's 162 / 258 / 270 g body
 * beside a 40 g rib). The rows written out carry the resolved value for every
 * size group, and on the way back a cell equal to the first column is read as
 * inherited again — so the next save keeps following the first column.
 */
import type { WeightDraft } from "./types";

/** The column key of the single "All sizes" column when no size group is chosen. */
export const ALL_SIZES = "all";

export type ConsumptionLine = {
  key: string;
  piece_key: string;
  component_id: string | null;
  fabric_key: string | null;
  /** Wastage Allowance % (0690) — one per line, every size group alike. */
  wastage_pct: string;
  /** Grams per column: size group id, or `ALL_SIZES`. Blank = inherit column 1. */
  cells: Record<string, string>;
};

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

/** Nothing typed that the operator HAS to type (the allowance is stamped). */
export const isBlankLine = (l: ConsumptionLine) =>
  !l.fabric_key && !l.component_id && !Object.values(l.cells).some(filled);

/** The columns a sheet shows: its chosen size groups, or the one All-sizes column. */
export const columnsOf = (sizeGroups: readonly string[]) => (sizeGroups.length ? [...sizeGroups] : [ALL_SIZES]);

/** The grams a cell resolves to — its own, else the first column's. */
export function cellGrams(l: ConsumptionLine, col: string, sizeGroups: readonly string[]): string {
  const cols = columnsOf(sizeGroups);
  const own = l.cells[col] ?? "";
  return filled(own) ? own.trim() : (l.cells[cols[0]] ?? "").trim();
}

/**
 * Matrix → stored rows. The FIRST column's row keeps the line's key (so a
 * problem on it — "pick the fabric", "enter the grams" — lands on the line's
 * own controls); the others are `line|group`. A column that resolves to no
 * grams writes nothing, except column 1, which always writes so an unfinished
 * line is reported rather than silently dropped.
 */
export function linesToWeights(lines: readonly ConsumptionLine[], sizeGroups: readonly string[]): WeightDraft[] {
  const cols = columnsOf(sizeGroups);
  const out: WeightDraft[] = [];
  for (const l of lines) {
    cols.forEach((col, i) => {
      const grams = cellGrams(l, col, sizeGroups);
      if (i > 0 && !grams) return;
      out.push({
        key: i === 0 ? l.key : `${l.key}|${col}`,
        piece_key: l.piece_key,
        fabric_key: l.fabric_key,
        component_id: l.component_id,
        size_group_id: col === ALL_SIZES ? null : col,
        weight_g: grams,
        length_cm: "",
        width_cm: "",
        gsm: "",
        wastage_pct: l.wastage_pct,
      });
    });
  }
  return out;
}

/** The line a stored row belongs to (`line|group` → `line`). */
export const baseKey = (weightKey: string) => weightKey.split("|")[0];

/**
 * Stored rows → matrix. Rows group into one line by (piece, component,
 * fabric, allowance); their size groups become the columns, in first-seen
 * order. A row saved with NO size group (an "every size" line, or every line of
 * a sheet that names no group) fills column 1. A cell equal to column 1 is
 * shown blank — inherited — again.
 *
 * Grams that came from L × W × GSM on a sheet saved before the matrix are
 * resolved to their figure here, so nothing typed is lost.
 */
export function weightsToLines(
  weights: readonly WeightDraft[],
  newKey: () => string,
  gramsOf: (w: WeightDraft) => number | null,
): { lines: ConsumptionLine[]; sizeGroups: string[] } {
  const sizeGroups: string[] = [];
  for (const w of weights) if (w.size_group_id && !sizeGroups.includes(w.size_group_id)) sizeGroups.push(w.size_group_id);
  const cols = columnsOf(sizeGroups);
  const byKey = new Map<string, ConsumptionLine>();
  for (const w of weights) {
    const k = [w.piece_key, w.component_id ?? "", w.fabric_key ?? "", w.wastage_pct.trim()].join("|");
    let line = byKey.get(k);
    if (!line) {
      line = { key: newKey(), piece_key: w.piece_key, component_id: w.component_id, fabric_key: w.fabric_key, wastage_pct: w.wastage_pct, cells: {} };
      byKey.set(k, line);
    }
    const g = gramsOf(w);
    const v = g == null ? w.weight_g : String(g);
    line.cells[w.size_group_id ?? cols[0]] = v;
  }
  const lines = [...byKey.values()].map((l) => {
    const first = (l.cells[cols[0]] ?? "").trim();
    const cells: Record<string, string> = {};
    cols.forEach((c, i) => {
      const v = (l.cells[c] ?? "").trim();
      cells[c] = i > 0 && v === first ? "" : v;
    });
    return { ...l, cells };
  });
  return { lines, sizeGroups };
}
