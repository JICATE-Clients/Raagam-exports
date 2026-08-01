import { fmtDate, fmtDateTime } from "@/lib/format";

/**
 * Turn a fetched row into label→value pairs for the read-only record view.
 *
 * WHY THE ROW AND NOT THE COLUMNS. A list shows a handful of columns; the record
 * behind it routinely holds five times that (Employee is 43 fields behind 6).
 * A view built from the columns can only repeat what the operator is already
 * looking at — it answers "what does this row say?", which they can see, rather
 * than "what is in this record?", which they cannot. So this reads the row.
 *
 * It is the fallback, not the ideal: a hand-written `view` (or the
 * columns-derived one `MasterListShell` builds, which resolves FKs through the
 * screen's own cell renderers) reads better and always wins. This exists so that
 * a screen with neither still has a working View — the alternative was ~100
 * listing tables where the only way to read a record was to open its editor.
 *
 * WHAT IS DROPPED, AND WHY
 *  - `id` and every `*_id`: a raw UUID tells the reader nothing, and the name
 *    behind it is not resolvable from here. Rows that carry a resolved
 *    `*_name` / `*_code` alongside the FK (most `lib/**\/*-service.ts` rows do)
 *    still show the readable half.
 *  - Empty values: `null`, `undefined`, `""`. These records are sparse by
 *    nature, and a wall of "—" tells the reader less than a short list of what
 *    is actually there.
 *  - Audit plumbing (`created_by`, `updated_at`, …) and anything `_`-prefixed.
 *
 * Dates go through `fmtDate` / `fmtDateTime` — never formatted here (AGENTS.md).
 */

/** Acronyms and shorthands that must not be title-cased into nonsense. */
const WORDS: Record<string, string> = {
  id: "ID",
  no: "No",
  dt: "Date",
  qty: "Qty",
  amt: "Amount",
  pct: "%",
  hsn: "HSN",
  hs: "HS",
  gst: "GST",
  gstin: "GSTIN",
  pan: "PAN",
  ifsc: "IFSC",
  ifs: "IFS",
  isd: "ISD",
  uom: "UOM",
  po: "PO",
  pi: "PI",
  sq: "SQ",
  ta: "TA",
  lc: "LC",
  dc: "DC",
  grn: "GRN",
  mrs: "MRS",
  csp: "CSP",
  iwo: "IWO",
  ppm: "PPM",
  bom: "BOM",
  epcg: "EPCG",
  cif: "CIF",
  fob: "FOB",
  smv: "SMV",
  pod: "POD",
  pf: "PF",
  esi: "ESI",
  tds: "TDS",
  tcs: "TCS",
  rtgs: "RTGS",
  nift: "NIFT",
  url: "URL",
  ioc: "IOC",
};

/** Keys whose humanized form reads worse than a chosen label. */
const LABELS: Record<string, string> = {
  entry_date: "Date",
  short_name: "Short Name",
};

/** `hsn_code` → "HSN Code"; `margin_pct` → "Margin %". */
export function humanizeKey(key: string): string {
  const override = LABELS[key];
  if (override) return override;
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

/**
 * Keys that are plumbing rather than content.
 *
 * The `created_*` trio is skipped here because both engines append a dedicated
 * "Created" section to the view sheet (`createdSection`, components/ui/
 * created-columns.tsx). Left in, this file would render a SECOND, differently
 * worded line — it labelled `created_at` "Created" and formatted it with
 * `fmtDateTime` where every table shows `fmtDate`.
 */
const SKIP = new Set([
  "id",
  "created_at",
  "created_by",
  "created_by_name",
  "creator",
  "updated_by",
  "updated_at",
  "deleted_at",
  "search_vector",
  "href",
  "key",
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** `proto`, `in_progress` -- a status key, safe to sentence-case. */
const ENUM_KEY = /^[a-z]+(?:_[a-z]+)*$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/**
 * The three flag columns that all mean the same thing to a reader, mapped onto
 * one honest label. Without this they read as "Is Active: Yes" / "Inactive: No".
 */
const STATUS_FLAGS: Record<string, (v: boolean) => string> = {
  is_active: (v) => (v ? "Active" : "Inactive"),
  inactive: (v) => (v ? "Inactive" : "Active"),
  blocked: (v) => (v ? "Blocked" : "Active"),
};

function scalar(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") {
    const flag = STATUS_FLAGS[key];
    return flag ? flag(value) : value ? "Yes" : "No";
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (DATE_TIME.test(s)) return fmtDateTime(s);
    if (DATE_ONLY.test(s)) return fmtDate(s);
    // A bare lowercase token is a status/enum key, not prose -- `in_progress`
    // reads as "In progress". Deliberately narrow: anything with a digit, dot,
    // @ or capital is left exactly as stored, so emails, URLs, codes and the
    // app's CAPS-stored names are never touched.
    if (ENUM_KEY.test(s)) {
      const words = s.replace(/_/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    return s;
  }
  return null;
}

/**
 * A joined relation (`country: { name }`) is worth one readable line; a child
 * collection (`branches: [...]`) is worth its size, because the rows themselves
 * belong to a grid, not to a label→value list.
 */
function related(value: object): string | null {
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return `${value.length} row${value.length === 1 ? "" : "s"}`;
  }
  const o = value as Record<string, unknown>;
  for (const k of ["name", "code", "label", "short_name", "title"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function pairsFromRow(row: unknown): [string, string][] {
  if (!row || typeof row !== "object") return [];

  const out: [string, string][] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (key.startsWith("_") || SKIP.has(key)) continue;
    // A FK's UUID is unreadable and unresolvable from here; the row's own
    // `*_name` / `*_code` twin (if it has one) carries the readable half.
    if (key.endsWith("_id")) continue;

    const text =
      value !== null && typeof value === "object"
        ? related(value)
        : scalar(key, value);
    if (text === null) continue;

    const label = key in STATUS_FLAGS ? "Status" : humanizeKey(key);
    // `is_active` and `inactive` can both be present; one Status line is enough,
    // and a duplicate label would collide on the view sheet's React keys.
    if (seen.has(label)) continue;
    seen.add(label);
    out.push([label, text]);
  }

  return out;
}

/** Best available human name for a record, for the view sheet's title. */
export function titleFromRow(row: unknown): string {
  if (!row || typeof row !== "object") return "Record";
  const o = row as Record<string, unknown>;
  for (const k of ["name", "short_name", "title", "label", "code", "entry_no"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "Record";
}
