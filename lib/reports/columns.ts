/**
 * Turns `ReportField` descriptors (plain data, from `registry.ts`) into
 * `ReportColumn`s (which carry closures).
 *
 * No "use client" directive: this is a pure module. What matters is that it is
 * *called from* a client component, so the closures it creates are born on the
 * client and never have to cross the RSC boundary — the constraint that shapes
 * every report page in this codebase.
 */

import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import {
  attributeName,
  isAttributeKey,
  type ReportField,
  type ValueFormat,
} from "./registry";
import type { ReportColumn } from "./types";

/** A fact row is addressed by string key; attributes live under `attributes`. */
export type FactRow = Record<string, unknown> & {
  attributes?: Record<string, string> | null;
};

/** Read a field off a row, transparently resolving `attr:<Name>` keys. */
export function fieldValue(row: FactRow, key: string): unknown {
  if (isAttributeKey(key)) {
    const attrs = row.attributes;
    return attrs ? attrs[attributeName(key)] : undefined;
  }
  return row[key];
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Display formatter per format kind. Never applied to the Excel value. */
export function formatterFor(format: ValueFormat): ((v: string | number) => string) | undefined {
  switch (format) {
    case "money":
      return (v) => (v === "" || v == null ? "—" : fmtMoney(toNumber(v)));
    case "qty":
    case "number":
      return (v) => (v === "" || v == null ? "—" : fmtNumber(toNumber(v)));
    case "percent":
      return (v) => `${toNumber(v).toFixed(1)}%`;
    case "date":
      return (v) => fmtDate(String(v));
    default:
      return undefined;
  }
}

const NUMERIC_FORMATS: ValueFormat[] = ["number", "qty", "money", "percent"];

/**
 * Build report columns from field descriptors.
 *
 * Measures return the RAW number from `value()` and format only for display, so
 * Excel receives something it can SUM. A column that returns `fmtMoney(...)`
 * from `value()` ships text into the spreadsheet and every total silently reads
 * as zero — that bug is why `format` exists on `ReportColumn`.
 */
export function columnsFromFields(fields: ReportField[]): ReportColumn<FactRow>[] {
  return fields.map((f) => {
    const numeric = NUMERIC_FORMATS.includes(f.format);
    return {
      key: f.key,
      header: f.label,
      isNumeric: numeric,
      format: formatterFor(f.format),
      value: (row: FactRow) => {
        const raw = fieldValue(row, f.key);
        if (numeric) return toNumber(raw);
        if (raw == null || raw === "") return "—";
        return String(raw);
      },
    };
  });
}
