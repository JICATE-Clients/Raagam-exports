/**
 * THE BUDGET STATEMENT IN THE SHEET FORMAT (user 2026-09-29: "this is okay
 * apply it" — the approved "Raagam Budget Statement" mockup). The display
 * decisions the screen (`components/orders/order-budget-report.tsx`) and the
 * PDF (`./report-export.ts`) both make, made ONCE here so the two cannot
 * disagree: each cost group's hue, the "where the cost goes" bar, the
 * "% · ₹ / pc" share text, a line's flag, and the quantity sum.
 *
 * DISPLAY ONLY. Every figure is `getOrderBudgetReport`'s — a group's value,
 * share and per-garment cost are its contribution fields, never re-derived.
 * Client-safe.
 */
import type { StageStyle } from "@/lib/orders/fabric-bom/report-colours";
import type { BudgetContribution, BudgetGroupHead, BudgetStatementLine, Fig, OrderBudgetReport } from "./report";
import { inr, isFigRefusal } from "./report-format";

/** One hue per cost group — the card, its bar segment and its legend swatch
 *  speak one colour. Keyed by the report's own group keys; an unknown key
 *  takes the app's blue rather than a guessed hue. */
const GROUP_TONES: Record<string, StageStyle> = {
  purchase: { label: "", tint: "#fdf1dc", rule: "#d98e04", ink: "#7a4b00" },
  yarn_process: { label: "", tint: "#fbe9d0", rule: "#b8700a", ink: "#6b3f00" },
  fabric_process: { label: "", tint: "#e1eff9", rule: "#037bb8", ink: "#024f78" },
  material_process: { label: "", tint: "#efeaf6", rule: "#6d4fa3", ink: "#452c73" },
  cmt: { label: "", tint: "#eceff3", rule: "#6b7480", ink: "#37404a" },
  garment_process: { label: "", tint: "#dff3f0", rule: "#138a7e", ink: "#0b5a52" },
  expense: { label: "", tint: "#f8e8ec", rule: "#b5566b", ink: "#7a2c3e" },
  income: { label: "", tint: "#eef7df", rule: "#85c227", ink: "#3f6a0d" },
};
const FALLBACK: StageStyle = { label: "", tint: "#eaf7fd", rule: "#037bb8", ink: "#024f78" };

/** The profit tile's green. */
export const PROFIT_TONE: StageStyle = GROUP_TONES.income;

export function groupTone(key: string): StageStyle {
  return GROUP_TONES[key] ?? FALLBACK;
}

/** "34.67% · ₹ 82.84 / pc" — a contribution's share and per-garment cost; a
 *  part that cannot be worked out is left out, never printed as 0. `rs` picks
 *  the currency mark (the PDF's fonts have no ₹ glyph, so it prints "Rs"). */
export function shareText(c: BudgetContribution, rs = "₹"): string {
  const parts: string[] = [];
  if (!isFigRefusal(c.pct)) parts.push(`${c.pct.toFixed(2)}%`);
  if (!isFigRefusal(c.perGarment)) parts.push(`${rs} ${c.perGarment.toFixed(2)} / pc`);
  return parts.join(" · ");
}

/** "₹ 4,37,154.20", or the refusal's sentence. */
export function money(v: Fig | null | undefined, rs = "₹"): string {
  if (v == null) return "";
  return isFigRefusal(v) ? v.refused : `${rs} ${inr(v)}`;
}

/** A line's Qty as the sheet prints it — Indian grouping, 2 to 3 decimals. */
export function qtyText(v: Fig | null | undefined): string {
  if (v == null) return "";
  if (isFigRefusal(v)) return v.refused;
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** A line's flag: free of charge, a percent of sales, or a flat amount —
 *  so a lump-sum or percentage line reads differently from qty × rate. */
export function lineFlag(l: BudgetStatementLine): string | null {
  if (l.foc) return "FOC";
  const r = l.rate.trim();
  // An expense line's particulars already say "(3 % of Sales Value)".
  if (/%$/.test(r)) return /of sales/i.test(l.particulars) ? null : `${r.replace(/\s+/g, "")} OF SALES`;
  if (r === "Flat") return /flat/i.test(l.particulars) ? null : "FLAT";
  return null;
}

export type CostSegment = { key: string; label: string; value: number; pct: number; share: string; tone: StageStyle };

/** "Where the cost goes" — each expense group's share of the total, to scale.
 *  Only groups with a worked-out value and share; income is not a cost. */
export function costSegments(r: OrderBudgetReport, rs = "₹"): CostSegment[] {
  return r.groups
    .filter((g) => !isFigRefusal(g.value) && !isFigRefusal(g.pct) && (g.value as number) > 0)
    .map((g) => ({
      key: g.key,
      label: g.label,
      value: g.value as number,
      pct: g.pct as number,
      share: shareText(g, rs),
      tone: groupTone(g.key),
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Should a Cost Head print its own sub-heading and subtotal row? Not when it
 * is the group's only head and says the same thing as the group (CMT inside
 * CMT) — the card header already carries its value, share and per-garment
 * cost. Everywhere else it does, so no contribution figure is lost.
 */
export function headIsOwnRow(g: BudgetGroupHead): boolean {
  return !(g.heads.length === 1 && g.heads[0].label.trim().toUpperCase() === g.label.trim().toUpperCase());
}

/** The quantity sum across every style the budget covers. Cut is the
 *  report's own Cut Qty — never re-added from the parts. */
export function quantitySum(r: OrderBudgetReport): {
  order: number;
  excess: number;
  approval: number;
  rejection: number;
  cut: Fig;
} {
  const add = (k: "order" | "excess" | "approval" | "rejection") =>
    r.quantities.reduce((sum, q) => sum + (q[k] ?? 0), 0);
  return { order: add("order"), excess: add("excess"), approval: add("approval"), rejection: add("rejection"), cut: r.cutQty };
}
