/**
 * Garment weight as a SIZE MATRIX (0693, user 2026-10-08): the style's sizes
 * across the top, components down the left, grams in the cells, and a Loss %
 * row under the components — one box per size.
 *
 * THE MATRIX IS A VIEW; THE ROWS ARE THE TRUTH. Storage, the server's checks,
 * `calc.ts` and both PDFs keep reading `WeightDraft` rows — one per component
 * × size — exactly as before, so no second arithmetic. This file is the two-way
 * bridge, and it is pure so `check:sample-costing` can pin it.
 *
 * SIZES ARE NAMES. A column key is a style size as ticked in Sample Entry ("S",
 * "M", …), never a Size Group id: most of a style's sizes sit in no active
 * group. The columns are the operator's choice — nothing is pre-selected.
 *
 * INHERITANCE. A grams cell left blank takes the FIRST column's grams, and a
 * Loss % box left blank takes the first column's loss: a rib that is 17 g in
 * every size is typed once. The rows written out carry the resolved value for
 * every size, and on the way back a cell equal to the first column is read as
 * inherited again — so the next save keeps following the first column.
 *
 * LOSS TRAVELS ON THE ROWS. `wastage_pct` is still a column of every weight
 * line (calc.ts's allowance maths is untouched); the matrix simply writes the
 * same value on every line of one size. A sheet saved with a different
 * allowance per line reads back as the FIRST line's value for that size.
 *
 * A LEGACY ROW with no size ("every size", saved before 0693) fills column 1.
 * When the sheet names no size at all it is shown in a single "All sizes"
 * column so the grams are never hidden.
 */
import type { WeightDraft } from "./types";

/** The internal key of the one "All sizes" column — a legacy row with no size. */
export const ALL_SIZES = "all";

export type ConsumptionLine = {
  key: string;
  piece_key: string;
  /** One or more components weighed together (0699). */
  component_ids: string[];
  fabric_key: string | null;
  /** Grams per column: a style size name, or `ALL_SIZES`. Blank = inherit column 1. */
  cells: Record<string, string>;
};

/** Loss % per column, typed. Blank = inherit column 1. */
export type LossBySize = Record<string, string>;

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

/** Nothing typed that the operator HAS to type. */
export const isBlankLine = (l: ConsumptionLine) =>
  !l.fabric_key && l.component_ids.length === 0 && !Object.values(l.cells).some(filled);

/** The columns a sheet writes: its chosen sizes, or the one All-sizes column. */
export const columnsOf = (sizes: readonly string[]) => (sizes.length ? [...sizes] : [ALL_SIZES]);

/** The grams a cell resolves to — its own, else the first column's. */
export function cellGrams(l: ConsumptionLine, col: string, sizes: readonly string[]): string {
  const cols = columnsOf(sizes);
  const own = l.cells[col] ?? "";
  return filled(own) ? own.trim() : (l.cells[cols[0]] ?? "").trim();
}

/** The Loss % a column resolves to — its own, else the first column's. */
export function lossFor(loss: LossBySize, col: string, sizes: readonly string[]): string {
  const cols = columnsOf(sizes);
  const own = loss[col] ?? "";
  return filled(own) ? own.trim() : (loss[cols[0]] ?? "").trim();
}

/**
 * Matrix → stored rows. The FIRST column's row keeps the line's key (so a
 * problem on it — "pick the fabric", "enter the grams" — lands on the line's
 * own controls); the others are `line|size`. A column that resolves to no
 * grams writes nothing, except column 1, which always writes so an unfinished
 * line is reported rather than silently dropped.
 */
export function linesToWeights(lines: readonly ConsumptionLine[], sizes: readonly string[], loss: LossBySize): WeightDraft[] {
  const cols = columnsOf(sizes);
  const out: WeightDraft[] = [];
  for (const l of lines) {
    cols.forEach((col, i) => {
      const grams = cellGrams(l, col, sizes);
      if (i > 0 && !grams) return;
      out.push({
        key: i === 0 ? l.key : `${l.key}|${col}`,
        piece_key: l.piece_key,
        fabric_key: l.fabric_key,
        component_ids: l.component_ids,
        size_name: col === ALL_SIZES ? null : col,
        weight_g: grams,
        length_cm: "",
        width_cm: "",
        gsm: "",
        wastage_pct: lossFor(loss, col, sizes),
      });
    });
  }
  return out;
}

/** The line a stored row belongs to (`line|size` → `line`). */
export const baseKey = (weightKey: string) => weightKey.split("|")[0];

/**
 * Stored rows → matrix. Rows group into one line by (piece, component,
 * fabric); their sizes become the columns, in first-seen order. A row saved
 * with NO size fills column 1. A cell equal to column 1 is shown blank —
 * inherited — again, and so is a Loss % equal to column 1's.
 *
 * Grams that came from L × W × GSM are resolved to their figure here, so
 * nothing typed is lost.
 */
export function weightsToLines(
  weights: readonly WeightDraft[],
  newKey: () => string,
  gramsOf: (w: WeightDraft) => number | null,
): { lines: ConsumptionLine[]; sizes: string[]; loss: LossBySize } {
  const sizes: string[] = [];
  for (const w of weights) if (w.size_name && !sizes.includes(w.size_name)) sizes.push(w.size_name);
  const cols = columnsOf(sizes);
  const byKey = new Map<string, ConsumptionLine>();
  const lossRaw: LossBySize = {};
  for (const w of weights) {
    const k = [w.piece_key, w.component_ids.join(","), w.fabric_key ?? ""].join("|");
    let line = byKey.get(k);
    if (!line) {
      line = { key: newKey(), piece_key: w.piece_key, component_ids: [...w.component_ids], fabric_key: w.fabric_key, cells: {} };
      byKey.set(k, line);
    }
    const col = w.size_name ?? cols[0];
    const g = gramsOf(w);
    line.cells[col] = g == null ? w.weight_g : String(g);
    if (lossRaw[col] === undefined && filled(w.wastage_pct)) lossRaw[col] = w.wastage_pct.trim();
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
  const firstLoss = lossRaw[cols[0]] ?? "";
  const loss: LossBySize = {};
  cols.forEach((c, i) => {
    const v = lossRaw[c] ?? "";
    loss[c] = i > 0 && v === firstLoss ? "" : v;
  });
  return { lines, sizes, loss };
}
