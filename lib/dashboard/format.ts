/**
 * Dashboard-specific formatters.
 *
 * Separate from lib/format.ts because a dashboard tile has ~80px to say what a
 * detail screen says in a full row. `fmtMoney` renders ₹4,82,17,340.00 — true,
 * and unreadable at 24px in a KPI card. Everything here trades precision for
 * scannability, so none of it belongs on a document or a report.
 */

const CRORE = 10_000_000;
const LAKH = 100_000;

/**
 * Indian short scale: ₹4.82 Cr / ₹18.4 L / ₹6,240.
 *
 * Crore and lakh (not M/B) because that is how the figures are spoken in the
 * office, and a dashboard that needs mental conversion isn't glanceable.
 */
export function fmtCompactInr(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= CRORE) return `${sign}₹${(abs / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${(abs / LAKH).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Plain counts and quantities: 42,180. Fractions are noise at this size. */
export function fmtCompactNumber(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/**
 * Period-on-period change, as a signed percentage.
 *
 * Returns null rather than "+100%" when the previous window was zero: growth
 * from nothing is not a percentage, and rendering one implies a trend that
 * a single order would have produced.
 */
export function delta(current: number, previous: number): { text: string; up: boolean } | null {
  if (!isFinite(current) || !isFinite(previous) || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!isFinite(pct)) return null;
  const rounded = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return { text: `${pct >= 0 ? "+" : ""}${rounded}%`, up: pct >= 0 };
}

/** "3 days" / "18 hours" — approvals ageing, where precision past a day is noise. */
export function fmtAge(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** Relative timestamp for the activity feed. */
export function fmtAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "";
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
