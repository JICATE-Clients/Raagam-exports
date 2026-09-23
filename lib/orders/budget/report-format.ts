/**
 * The Budget Statement's number and sentence formats — client-safe, so the
 * on-screen view, the PDF and the spreadsheet print every figure the same way.
 *
 * The legacy printout's own conventions: a line's Value and Rate plain to 2dp
 * ("168545.87"), a Qty to 3dp where it has them ("591.389", "263.00"), and
 * every CONTRIBUTION / summary figure in Indian grouping ("6,22,446.87").
 */
import type { BudgetContribution, Fig } from "./report";

export const isFigRefusal = (v: Fig | null | undefined): v is { refused: string } =>
  typeof v === "object" && v !== null && "refused" in v;

/** "168545.87" — a line's Value. */
export function plain2(v: Fig | null | undefined): string {
  if (v == null) return "";
  return isFigRefusal(v) ? v.refused : v.toFixed(2);
}

/** "591.389" / "263.00" — a line's Qty. */
export function qty3(v: Fig | null | undefined): string {
  if (v == null) return "";
  if (isFigRefusal(v)) return v.refused;
  return v.toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** "6,22,446.87" — a contribution or summary figure. */
export function inr(v: Fig | null | undefined): string {
  if (v == null) return "";
  if (isFigRefusal(v)) return v.refused;
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "YARN PURCHASE CONTRIBUTION ( 32.60 % ) RS. 194.09 PER GARMENT" — the
 *  legacy's sentence. A part that cannot be worked out is left out rather
 *  than printed as 0. */
export function contributionText(label: string, c: BudgetContribution): string {
  const pct = isFigRefusal(c.pct) ? "" : ` ( ${c.pct.toFixed(2)} % )`;
  const per = isFigRefusal(c.perGarment) ? "" : ` RS. ${c.perGarment.toFixed(2)} PER GARMENT`;
  return `${label.toUpperCase()} CONTRIBUTION${pct}${per}`;
}

/** The quantity columns' cell — blank for nothing, as the legacy prints it. */
export function qtyCell(v: number | null | undefined): string {
  return v ? v.toLocaleString("en-IN") : "";
}
