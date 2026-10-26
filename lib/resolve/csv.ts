/*
 * RFC 4180 CSV — pure, client-safe. Every field that contains a comma, quote,
 * CR or LF is quoted, quotes are doubled, rows end CRLF. A field that starts
 * with = + - @ (or a tab / CR) is prefixed with an apostrophe so a spreadsheet
 * opening the export never evaluates an operator-typed title as a formula.
 */

export type CsvCell = string | number | boolean | null | undefined;

export function csvField(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
