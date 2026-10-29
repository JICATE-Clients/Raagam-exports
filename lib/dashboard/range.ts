import type { DashboardFilters, DashboardRange, RangeWindow } from "./types";
import { DASHBOARD_RANGES } from "./types";
import { addDays, addMonths, daysBetween, endOfMonth, isCalendarDate, startOfMonth, today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";

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
  range: Exclude<DashboardRange, "custom">,
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

/** The longest custom window — a year and a day, so "this FY" always fits. */
const MAX_CUSTOM_DAYS = 366;

/**
 * A custom window off the query string, or null when it is not a usable one —
 * the page then falls back to Month rather than refusing to render.
 *
 * Reversed dates are swapped rather than rejected (the operator meant the
 * span, not the order), and a span longer than a year is cut back to a year
 * ending on `to`: every KPI query scans the window AND the equal window before
 * it, so an unbounded custom range is an unbounded scan.
 */
export function parseCustom(
  rawFrom: string | undefined,
  rawTo: string | undefined,
): { from: string; to: string } | null {
  if (!rawFrom || !rawTo || !isCalendarDate(rawFrom) || !isCalendarDate(rawTo)) return null;
  const [first, to] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom];
  const from = daysBetween(first, to) > MAX_CUSTOM_DAYS - 1 ? addDays(to, -(MAX_CUSTOM_DAYS - 1)) : first;
  return { from, to };
}

/**
 * The window the filters ask for. A custom span compares against the span of
 * the same length immediately before it — like against like, the rule
 * `rangeWindow` already follows for Today and Week.
 */
export function filterWindow(f: DashboardFilters, now: Date = new Date()): RangeWindow {
  if (f.range === "custom" && f.from && f.to) {
    const len = daysBetween(f.from, f.to) + 1;
    return { from: f.from, to: f.to, prevFrom: addDays(f.from, -len), prevTo: addDays(f.from, -1) };
  }
  return rangeWindow(f.range === "custom" ? "month" : f.range, now);
}

/** What the comparison is against, in words, for a KPI's hint line. */
export function compareLabel(f: DashboardFilters): string {
  switch (f.range) {
    case "today":
      return "vs yesterday";
    case "week":
      return "vs last week";
    case "custom":
      return "vs previous period";
    default:
      return "vs last month";
  }
}

/** The window in words, for the toolbar — DD/MM/YYYY like every date here. */
export function windowLabel(f: DashboardFilters, now: Date = new Date()): string {
  const w = filterWindow(f, now);
  return w.from === w.to ? fmtDate(w.from) : `${fmtDate(w.from)} – ${fmtDate(w.to)}`;
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
