import {
  addDays,
  addMonths,
  endOfMonth,
  isoDateInTZ,
  startOfMonth,
  startOfWeek,
  today,
} from "@/lib/calendar";
import { fmtDate } from "@/lib/format";

/**
 * The CREATED DATE filter, shared by every list screen in the app.
 *
 * ## The whole thing is one string
 *
 * `useMasterFilter` carries facets as `Record<string, string>` — one string per
 * facet — and every list screen in the app is already built on that. A date
 * range is two dates and a preset, so the obvious move is to widen the facet
 * type to an object; the cheaper and much safer one is to encode the range INTO
 * a single string, which is what this file does. Nothing else has to change:
 * `activeCount`, `reset`, and the facet plumbing all keep working, and a range
 * survives being put in a URL or `localStorage` without a serializer.
 *
 *   ""                        no filter
 *   "today" | "yesterday"     …and the other presets below
 *   "custom:2026-07-01:2026-07-31"   both ends
 *   "custom:2026-07-01:"      FROM only  — on or after
 *   "custom::2026-07-31"      TO only    — on or before
 *   "custom::"                the Custom row is OPEN but empty
 *
 * The open-ended forms are not an edge case, they are two of the options the
 * client asked for ("From Date", "To Date") — an operator filtering "everything
 * since we went live" has no end date in mind.
 *
 * `"custom::"` is a MODE, not a filter, and it has to be representable: the
 * operator picks "Custom Date Range" and the two date boxes appear *before*
 * they have typed anything. Collapsing that to `""` — the tidy-looking choice —
 * makes the control uncontrollable, because the boxes it just revealed would
 * unmount on the same keystroke that revealed them. `resolveDateWindow` returns
 * `null` for it instead, so it filters nothing, never lights the active-count
 * badge, and never offers a Reset link over a filter that excludes nothing.
 *
 * ## Every boundary is a calendar date at the FACTORY
 *
 * `created_at` is a `timestamptz`, which arrives in UTC. Reducing it to a day
 * with `slice(0, 10)` files every record created before 05:30 IST under the
 * previous day, so "Today" would silently hide the morning's work. `isoDateInTZ`
 * (lib/calendar.ts) is the only correct way to get the day, and it is the reason
 * this filter is a shared module rather than four lines in each screen.
 */

export type DatePreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

/**
 * The dropdown, in order. "All" is the empty value and is rendered by the
 * control, not listed here.
 *
 * `thisWeek` / `thisMonth` end at TODAY rather than at the end of the calendar
 * period, matching the dashboard's month range (lib/dashboard/range.ts) — and
 * the difference is invisible for a created date anyway, since nothing can be
 * created in the future. They START on the calendar boundary, which is what
 * makes them "this week" rather than "the last 7 days"; the dashboard's rolling
 * `week` is a KPI comparison window and is deliberately a different thing.
 */
export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom Date Range" },
];

const PRESET_VALUES = new Set<string>(DATE_PRESETS.map((p) => p.value));

/** A resolved window. `""` at either end means unbounded on that side. */
export type DateWindow = { from: string; to: string };

/** The three parts of an encoded value, for the control to render. */
export type DateFilterParts = { preset: DatePreset | ""; from: string; to: string };

/** Split an encoded value. Accepts anything; never throws. */
export function decodeDateFilter(value: string | undefined | null): DateFilterParts {
  const raw = (value ?? "").trim();
  if (!raw) return { preset: "", from: "", to: "" };
  if (raw.startsWith("custom:")) {
    // Exactly two separators after the tag, so an empty end stays empty rather
    // than collapsing the pair.
    const [, from = "", to = ""] = raw.split(":");
    return { preset: "custom", from, to };
  }
  return PRESET_VALUES.has(raw) && raw !== "custom"
    ? { preset: raw as DatePreset, from: "", to: "" }
    : { preset: "", from: "", to: "" };
}

/**
 * Build an encoded value. An empty custom range stays `"custom::"` — see the
 * header: it is the open-but-unfilled state of the control, and `activeCount`
 * asks `resolveDateWindow`, not this, whether anything is actually filtered.
 */
export function encodeDateFilter({ preset, from, to }: DateFilterParts): string {
  if (!preset) return "";
  if (preset !== "custom") return preset;
  return `custom:${from}:${to}`;
}

/**
 * The window an encoded value covers, as calendar dates at the factory.
 * `null` when nothing is being filtered.
 *
 * `now` is injectable so this is testable and so a caller can resolve a whole
 * page against one instant rather than re-reading the clock per row.
 */
export function resolveDateWindow(
  value: string | undefined | null,
  now: Date = new Date(),
): DateWindow | null {
  const { preset, from, to } = decodeDateFilter(value);
  if (!preset) return null;
  if (preset === "custom") {
    if (!from && !to) return null;
    // Entered backwards → read it as the range they meant. The inputs carry
    // min/max so this normally cannot happen by clicking, but a typed date
    // slips past that, and an empty table with no explanation is a worse
    // answer than the obvious one.
    return from && to && from > to ? { from: to, to: from } : { from, to };
  }

  const t = today(now);
  switch (preset) {
    case "today":
      return { from: t, to: t };
    case "yesterday": {
      const y = addDays(t, -1);
      return { from: y, to: y };
    }
    case "thisWeek":
      return { from: startOfWeek(t), to: t };
    case "thisMonth":
      return { from: startOfMonth(t), to: t };
    case "lastMonth": {
      const prev = addMonths(startOfMonth(t), -1);
      return { from: prev, to: endOfMonth(prev) };
    }
  }
}

/**
 * Does this record's `created_at` fall in the window?
 *
 * A row with NO created date never matches an active filter. That is the honest
 * answer — "created between X and Y" cannot be true of a record with no creation
 * date — but it is also why the hook only offers the filter when the rows
 * actually carry the column (see `useMasterFilter`), rather than letting a
 * screen whose service does not select it silently filter to nothing.
 */
export function matchesDateWindow(
  createdAt: string | Date | null | undefined,
  window: DateWindow | null,
): boolean {
  if (!window) return true;
  const day = isoDateInTZ(createdAt);
  if (!day) return false;
  if (window.from && day < window.from) return false;
  if (window.to && day > window.to) return false;
  return true;
}

/** One-shot convenience for a single row; prefer resolving the window once. */
export function matchesCreatedDate(
  createdAt: string | Date | null | undefined,
  value: string | undefined | null,
  now: Date = new Date(),
): boolean {
  return matchesDateWindow(createdAt, resolveDateWindow(value, now));
}

/**
 * The filter in words — DD/MM/YYYY via `fmtDate`, never the raw ISO the
 * comparison runs on.
 *
 * It describes the RESOLVED window, not the label that was picked, which is the
 * whole point of showing it: "This Month" tells an operator nothing they can
 * check, "01/08/2026 – 01/08/2026" tells them exactly which rows they are
 * looking at and makes a wrong system clock visible instead of mysterious.
 */
export function describeDateFilter(
  value: string | undefined | null,
  now: Date = new Date(),
): string {
  const w = resolveDateWindow(value, now);
  if (!w) return "";
  if (w.from && w.to) {
    return w.from === w.to ? fmtDate(w.from) : `${fmtDate(w.from)} – ${fmtDate(w.to)}`;
  }
  if (w.from) return `From ${fmtDate(w.from)}`;
  if (w.to) return `Up to ${fmtDate(w.to)}`;
  return "";
}
