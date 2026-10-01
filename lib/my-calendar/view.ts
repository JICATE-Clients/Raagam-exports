import { addDays, addMonths, endOfMonth, isCalendarDate, startOfMonth, startOfWeek } from "@/lib/calendar";

/**
 * The calendar's URL state — `cv` (view), `cd` (the date the view is about),
 * `cs` (mine | team). The calendar is LINKS, not client state, so it can sit on
 * the zero-JavaScript Dashboard as well as on My Work, and a view can be
 * bookmarked or sent to someone.
 */
export type CalView = "day" | "month" | "year";

export type CalParams = { cv?: string; cd?: string; cs?: string };

export function readCalParams(sp: CalParams, todayIso: string) {
  const view: CalView = sp.cv === "month" || sp.cv === "year" ? sp.cv : "day";
  const cursor = sp.cd && isCalendarDate(sp.cd) ? sp.cd : todayIso;
  const scope = sp.cs === "team" ? ("team" as const) : ("mine" as const);
  return { view, cursor, scope };
}

/**
 * The dates a view needs loaded. A month loads the whole Monday–Sunday grid.
 * The Today view shows the cursor's mini month beside Overdue · the day · the
 * next 7 days, so it loads that month's grid stretched to cover cursor + 7
 * (the caller adds the overdue look-back with `withOverdue`).
 */
export function calendarWindow(view: CalView, cursor: string): { from: string; to: string } {
  if (view === "day") {
    const from = startOfWeek(startOfMonth(cursor));
    const gridEnd = addDays(from, 41);
    const weekEnd = addDays(cursor, 7);
    return { from, to: gridEnd > weekEnd ? gridEnd : weekEnd };
  }
  if (view === "month") {
    const first = startOfMonth(cursor);
    const from = startOfWeek(first);
    return { from, to: addDays(from, 41) };
  }
  const y = cursor.slice(0, 4);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** The cursor one step back / forward in the current view. */
export function stepCursor(view: CalView, cursor: string, dir: -1 | 1): string {
  if (view === "day") return addDays(cursor, dir);
  if (view === "month") return addMonths(startOfMonth(cursor), dir);
  return addMonths(`${cursor.slice(0, 4)}-01-01`, 12 * dir);
}

/** The 42 dates of a month grid, Monday first. */
export function monthGrid(cursor: string): string[] {
  const from = startOfWeek(startOfMonth(cursor));
  return Array.from({ length: 42 }, (_, i) => addDays(from, i));
}

/** Every date of the month `cursor` is in. */
export function monthDays(cursor: string): string[] {
  const first = startOfMonth(cursor);
  const last = endOfMonth(cursor);
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}
