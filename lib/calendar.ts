/**
 * Timezone-aware calendar arithmetic, in plain `YYYY-MM-DD` strings.
 *
 * ## Why the timezone matters here and nowhere else
 *
 * Most of the app derives "today" with `new Date().toISOString()`, which is UTC.
 * For a Tirupur user that is wrong for the first 5.5 hours of every day: at
 * 02:00 IST, UTC still says yesterday. That was survivable while nothing
 * surfaced a single-day figure — and then two things did. The dashboard's
 * "Today" KPI (which is where this code was born, in lib/dashboard/range.ts),
 * and now the **Created Date** filter on every list screen: an operator who adds
 * a record at 09:00 IST and cannot find it under "Today" has been handed a
 * broken filter, not a subtle rounding error.
 *
 * ## Everything is a string, deliberately
 *
 * The values being compared are Postgres `date` columns and `timestamptz`
 * columns reduced to a calendar date. ISO strings compare exactly with `<=` and
 * `>=`, carry no instant, and cannot drift a day the way a `Date` does when it
 * crosses midnight in the wrong zone.
 *
 * **These are NOT display values.** Do not "fix" them to DD/MM/YYYY when
 * sweeping dates (client 2026-07-29 asked for DD/MM/YYYY everywhere, and this is
 * the one place it must not reach) — reformatting breaks every range silently,
 * because the strings still compare, just wrongly. Render with `fmtDate`
 * (lib/format.ts) at the edge instead.
 *
 * Extracted from lib/dashboard/range.ts, which still re-exports the lot, so the
 * app has exactly one implementation of this arithmetic rather than a second
 * copy living beside the list filters.
 */

const TZ = "Asia/Kolkata";

// en-CA formats as YYYY-MM-DD, which is the format we compare with.
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

/**
 * The calendar date a TIMESTAMP fell on, at the factory. `null` when unparseable.
 *
 * This is the piece the Created Date filter turns on, and the reason it cannot
 * be `value.slice(0, 10)`. `created_at` is a `timestamptz`, which Postgres hands
 * over in UTC: a row created at 09:00 IST on the 5th is stored as
 * `2026-07-05T03:30:00Z` (fine, same date), but one created at 02:00 IST on the
 * 5th is `2026-07-04T20:30:00Z` — and slicing that string files it under the
 * 4th. Every early-morning record would go missing from "Today".
 */
export function isoDateInTZ(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return ISO_IN_TZ.format(d);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The SHAPE of a `YYYY-MM-DD`, and nothing about whether the day exists. */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real day on the calendar?
 *
 * ## THE SHAPE AND THE CALENDAR ARE TWO DIFFERENT QUESTIONS
 *
 * This is the distinction the next reader will collapse, so it is worth being
 * blunt: `/^\d{4}-\d{2}-\d{2}$/` asks whether a string LOOKS like a date. It
 * says nothing about whether that date happened. `2026-02-31` passes the shape
 * test, and every function in this file treats `Date.UTC` as a calendar, which
 * silently ROLLS IT OVER to March 3 rather than erroring.
 *
 * That rollover is the dangerous kind of wrong. It does not throw, it does not
 * return null, and it does not produce anything an operator could look at and
 * call wrong — it produces a different real date. `2026-00-10` lands in
 * DECEMBER 2025, a month and a year away from where it reads.
 *
 * It reached a scheduler. The T&A ladder derives every date backwards from one
 * anchor, so an anchor of `2026-02-31` dated the whole plan off a day that does
 * not exist and the derived dates STRADDLED it — Feb 27 and Mar 2 either side of
 * an anchor printed as Feb 31 — with no refusal anywhere and every individual
 * date a real one.
 *
 * ## A ROUND TRIP, NOT A BIGGER REGEX
 *
 * Build the date and compare it back to the input. February, leap years and the
 * 30/31-day months then answer for themselves: `2026-02-29` rebuilds as
 * `2026-03-01` and fails, `2028-02-29` rebuilds as itself and passes, and
 * nothing here holds a month-length table or a leap-year rule that could
 * disagree with the arithmetic the rest of the file does.
 *
 * A regex enumerating month lengths would be a SECOND statement of the calendar,
 * free to drift from `Date.UTC`'s — and the century rule (2100 is not a leap
 * year, 2000 is) is exactly the sort of thing a hand-written pattern gets wrong
 * once and nobody re-reads.
 *
 * One caveat, deliberate: `Date.UTC` maps years 0–99 onto 1900–1999, so
 * `0026-02-01` rebuilds as `1926-02-01` and is refused. A four-digit year in the
 * first century is not a date this business has, and refusing is the safe way to
 * be wrong about it.
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_SHAPE.test(value)) return false;
  const [y, m, d] = parts(value);
  return fromUTC(Date.UTC(y, m - 1, d)) === value;
}

/** Shift a YYYY-MM-DD by whole days. Uses UTC internally purely as a calendar. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return fromUTC(Date.UTC(y, m - 1, d + days));
}

/**
 * Which day of the week a YYYY-MM-DD falls on: 0 = Sunday … 6 = Saturday.
 *
 * `getUTCDay`, never `getDay`. The whole file treats `Date.UTC` as a calendar
 * rather than an instant, and the local-time reader is where that discipline
 * breaks: `new Date("2026-08-23").getDay()` west of UTC answers for the 22nd, so
 * a Sunday reads as a Saturday and a working-day scheduler quietly stops
 * skipping it. Same trap `isoDateInTZ` above exists to close, one accessor over.
 */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Whole calendar days from `a` to `b`. Negative when `b` is before `a`.
 *
 * Both operands are midnight UTC, so there is no partial day to round and no DST
 * to absorb — the subtraction is exact by construction.
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
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

/**
 * The MONDAY of the week `iso` falls in.
 *
 * Monday, not Sunday: the working week here starts on Monday, and an operator
 * filtering "This Week" on a Monday morning expecting to see today's entries
 * would otherwise get a window that began yesterday. `getUTCDay` is safe because
 * the value is already a bare calendar date — no instant, nothing to shift.
 */
export function startOfWeek(iso: string): string {
  const [y, m, d] = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7)); // Monday = 0
}
