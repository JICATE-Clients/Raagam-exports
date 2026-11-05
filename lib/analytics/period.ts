import { today } from "@/lib/dashboard/range";

/**
 * THE ANALYTICS PERIOD (Phase 1, user 2026-11-05).
 *
 * A financial year, April to March, because that is the year every document in
 * this app is numbered in (RE/26-27/…, PO/26-27/…). A calendar year would split
 * one numbering series across two periods and compare it with half of another.
 *
 * Three words only, so a board never has to explain a custom range: this FY,
 * last FY, everything. "Compared with" is always the FY before the one shown;
 * "all" has nothing before it and shows no comparison.
 */
export type PeriodKey = "fy" | "lfy" | "all";

export type Period = {
  key: PeriodKey;
  label: string;
  /** Inclusive ISO dates; null on "all". */
  from: string | null;
  to: string | null;
  /** The period this one is compared with, or null. */
  prev: { label: string; from: string; to: string } | null;
};

const fyLabel = (startYear: number) => `FY ${String(startYear % 100).padStart(2, "0")}-${String((startYear + 1) % 100).padStart(2, "0")}`;
const fyRange = (startYear: number) => ({ from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` });

/** The FY a date falls in, by its starting year (2026-11-05 → 2026; 2027-02-01 → 2026). */
export function fyStartYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

export function parsePeriod(raw: string | string[] | undefined, now: string = today()): Period {
  const key: PeriodKey = raw === "lfy" || raw === "all" ? raw : "fy";
  if (key === "all") return { key, label: "All time", from: null, to: null, prev: null };
  const start = fyStartYear(now) - (key === "lfy" ? 1 : 0);
  return {
    key,
    label: fyLabel(start),
    ...fyRange(start),
    prev: { label: fyLabel(start - 1), ...fyRange(start - 1) },
  };
}

/** Does an ISO date fall inside [from, to]? A null date is in "all" only. */
export function inRange(iso: string | null | undefined, r: { from: string | null; to: string | null }): boolean {
  if (r.from == null || r.to == null) return true;
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= r.from && d <= r.to;
}

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "fy", label: "This FY" },
  { value: "lfy", label: "Last FY" },
  { value: "all", label: "All time" },
];
