/**
 * Config-driven report model. A report page declares *what* it shows via a
 * `ReportConfig`; the shared `<ReportView>` shell then renders it as a table and
 * gives it PDF / Excel / Print / chart affordances for free.
 *
 * Columns expose a `value(row)` returning an export-safe primitive (string | number).
 * This is deliberately separate from `DataTable`'s JSX `cell` — exporters (PDF/Excel)
 * need flat scalars, not React nodes. The on-screen table renders `value()` too, so
 * screen, PDF and Excel stay in lock-step.
 */

export type ReportCellAlign = "left" | "right" | "center";

export interface ReportColumn<T> {
  /** Stable key (used as the Excel header fallback + React keys). */
  key: string;
  header: string;
  align?: ReportCellAlign;
  /** Flat, export-safe cell value for screen / PDF / Excel. */
  value: (row: T) => string | number;
  /** Right-align + tabular-nums on screen and number-format in Excel. */
  isNumeric?: boolean;
}

export type ReportChartKind = "bar" | "line" | "pie";

/** Optional chart spec. `category` = x-axis / slice label; `series` = numeric measures. */
export interface ReportChartConfig<T> {
  kind: ReportChartKind;
  /** Category label per row (x-axis tick or pie slice name). */
  category: (row: T) => string;
  series: Array<{
    key: string;
    label: string;
    value: (row: T) => number;
  }>;
}

export interface ReportConfig<T> {
  /** Human title — also the PDF heading and Excel sheet/file name stem. */
  title: string;
  /** Optional subtitle rendered under the title in the PDF. */
  subtitle?: string;
  columns: ReportColumn<T>[];
  rows: T[];
  chart?: ReportChartConfig<T>;
}

/** Slugify a report title into a safe download filename stem. */
export function reportFilename(title: string, ext: string): string {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report";
  return `${stem}.${ext}`;
}

/** Flatten config rows into a header array + matrix of cell values (shared by exporters). */
export function reportMatrix<T>(config: ReportConfig<T>): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: config.columns.map((c) => c.header),
    rows: config.rows.map((row) => config.columns.map((c) => c.value(row))),
  };
}
