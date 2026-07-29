/**
 * Collapse the fine-grain fact rows (item × store × month) onto whichever
 * dimensions the user picked.
 *
 * This is why `report_item_summary` has no dynamic `group by`: the RPC returns
 * the finest grain with every dimension key attached, and re-pivoting happens
 * here. It keeps the SQL injection-free (no identifier interpolation) and lets
 * the user change the grouping without another round-trip to the database.
 */

import { fieldValue, type FactRow } from "./columns";

const SEP = "␟"; // unit separator — cannot occur in a name

function keyOf(row: FactRow, dimensions: string[]): string {
  return dimensions.map((d) => String(fieldValue(row, d) ?? "")).join(SEP);
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Group `rows` by `dimensions`, summing `measures`. Dimension values are taken
 * from the first row of each group; every other column is dropped, because a
 * value that varies within a group cannot be represented in a rolled-up row.
 *
 * Passing an empty `dimensions` array returns a single grand-total row.
 */
export function rollup(
  rows: FactRow[],
  dimensions: string[],
  measures: string[],
): FactRow[] {
  const groups = new Map<string, FactRow>();

  for (const row of rows) {
    const key = keyOf(row, dimensions);
    let target = groups.get(key);

    if (!target) {
      target = {};
      for (const d of dimensions) target[d] = fieldValue(row, d) ?? null;
      for (const m of measures) target[m] = 0;
      groups.set(key, target);
    }

    for (const m of measures) {
      target[m] = toNumber(target[m]) + toNumber(row[m]);
    }
  }

  return [...groups.values()];
}

/** Sum one measure across rows — for the KPI tiles above a report. */
export function total(rows: FactRow[], measure: string): number {
  return rows.reduce((sum, r) => sum + toNumber(r[measure]), 0);
}
