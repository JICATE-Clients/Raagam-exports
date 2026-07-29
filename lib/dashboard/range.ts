import type { DashboardRange, RangeWindow } from "./types";
import { DASHBOARD_RANGES } from "./types";

/**
 * Calendar arithmetic for the dashboard's range selector.
 *
 * ## Why this is timezone-aware when the rest of the app isn't
 *
 * Everywhere else the app derives "today" with `new Date().toISOString()`, which
 * is UTC. For a Tirupur user that is wrong for the first 5.5 hours of every day:
 * at 02:00 IST, UTC still says yesterday. That has been survivable because
 * nothing surfaced a single-day figure — but "Today" on the dashboard does
 * exactly that, and a KPI that silently reports yesterday until breakfast is
 * worse than no KPI. So dates here are computed in the business's own timezone.
 *
 * Everything is a plain `YYYY-MM-DD` string: the columns being filtered
 * (`order_date`, `entry_date`, `invoice_date`, `planned_date`) are Postgres
 * `date`, and string comparison on ISO dates is exact.
 */

const TZ = "Asia/Kolkata";

// en-CA formats as YYYY-MM-DD, which is the format we want to compare with.
//
// NOT a display format — do not "fix" this to DD/MM/YYYY when sweeping dates
// (client 2026-07-29 asked for DD/MM/YYYY everywhere, and this is the one place
// it must not reach). The output is compared against Postgres `date` values and
// fed back into queries; reformatting it breaks every range on the dashboard
// silently, because the strings still compare — just wrongly.
const ISO_IN_TZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date at the factory, as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  return ISO_IN_TZ.format(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD by whole days. Uses UTC internally purely as a calendar. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return fromUTC(Date.UTC(y, m - 1, d + days));
}

export function startOfMonth(iso: string): string {
  const [y, m] = parts(iso);
  return fromUTC(Date.UTC(y, m - 1, 1));
}

/** Day 0 of the next month = last day of this one. */
export function endOfMonth(iso: string): string {
  const [y, m] = parts(iso);
  return fromUTC(Date.UTC(y, m, 0));
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  return fromUTC(Date.UTC(y, m - 1 + months, d));
}

/** Accepts anything off the query string; never throws. */
export function parseRange(raw: string | undefined): DashboardRange {
  return DASHBOARD_RANGES.includes(raw as DashboardRange)
    ? (raw as DashboardRange)
    : "month";
}

/**
 * The window a range covers, plus the equal-length window immediately before it.
 *
 * The previous window is what makes a delta honest: comparing a part-month
 * against a whole previous month would show a fake collapse on the 2nd of every
 * month. `month` therefore compares month-to-date against the *whole* previous
 * month only because that is the convention the existing /analytics page uses;
 * today and week compare like against like.
 */
export function rangeWindow(
  range: DashboardRange,
  now: Date = new Date(),
): RangeWindow {
  const t = today(now);

  if (range === "today") {
    const y = addDays(t, -1);
    return { from: t, to: t, prevFrom: y, prevTo: y };
  }

  if (range === "week") {
    return {
      from: addDays(t, -6),
      to: t,
      prevFrom: addDays(t, -13),
      prevTo: addDays(t, -7),
    };
  }

  const monthStart = startOfMonth(t);
  const prevMonthEnd = addDays(monthStart, -1);
  return {
    from: monthStart,
    to: t,
    prevFrom: startOfMonth(prevMonthEnd),
    prevTo: prevMonthEnd,
  };
}

/**
 * Trailing twelve months, whole months, ending with the current one.
 *
 * Trend charts are pinned to this regardless of the range selector: the
 * analytics RPCs bucket by `date_trunc('month', …)`, so a "today" trend would
 * be a single bar — indistinguishable from a rendering bug. Each chart states
 * its own period in its subtitle instead.
 */
export function trailing12(now: Date = new Date()): { from: string; to: string } {
  const t = today(now);
  return { from: startOfMonth(addMonths(startOfMonth(t), -11)), to: endOfMonth(t) };
}

/** The 12 months preceding trailing12 — used only for the year-on-year badge. */
export function priorTrailing12(now: Date = new Date()): { from: string; to: string } {
  const { from } = trailing12(now);
  return { from: addMonths(from, -12), to: addDays(from, -1) };
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  month: "short",
});

/** "2026-07-01" → "Jul". Parsed as UTC so the label can't slip a month. */
export function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return isNaN(d.getTime()) ? "" : MONTH_LABEL.format(d);
}
