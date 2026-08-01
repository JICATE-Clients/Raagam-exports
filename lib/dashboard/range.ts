import type { DashboardRange, RangeWindow } from "./types";
import { DASHBOARD_RANGES } from "./types";
import { addDays, addMonths, endOfMonth, startOfMonth, today } from "@/lib/calendar";

/**
 * The dashboard's range selector, built on the shared calendar arithmetic in
 * `lib/calendar.ts`.
 *
 * That arithmetic used to live here, and moved out when the Created Date filter
 * on the list screens needed the same timezone-aware "what day is it in Tirupur"
 * answer (2026-07-31). The alternative was a second copy beside the filters, and
 * a second copy of date maths is how two screens end up disagreeing about what
 * "today" means. See `lib/calendar.ts` for why the timezone matters and why
 * every value here is a plain `YYYY-MM-DD` string that must never be reformatted
 * for display.
 *
 * Re-exported below so the existing dashboard/analytics call sites keep their
 * imports; new code should reach for `@/lib/calendar` directly.
 */
export { today, addDays, startOfMonth, endOfMonth, addMonths };

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
