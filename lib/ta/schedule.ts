/**
 * Time & Action — scheduling BACKWARD from the delivery date.
 *
 *     Target Date = the downstream task's target − this process's lead time
 *
 * A T&A plan is written from its deadline inwards: the goods ship on a date the
 * buyer fixed, so Final Inspection is some days before that, Packing before
 * that, and so on back to Material In-House. Every date in the ladder is derived
 * from the one after it, and the delivery date is the only fixed point.
 *
 * ## THE APP ALREADY SCHEDULES FORWARD, AND THAT IS THE OTHER DIRECTION
 *
 * `ta-plan-screen.tsx` computes `End = Start + Days Required` per row. That is
 * useful once a plan is underway and answers a different question — "when does
 * this finish if it starts here". It cannot answer "when must this start for the
 * order to ship on time", which is what a plan is FOR.
 *
 * ## WORKING DAYS, AND SUNDAY IS THE ONLY ONE OFF (for now)
 *
 * "3 days before Ironing" across a weekend is a different date under calendar
 * and working days, and the difference is always in the dangerous direction:
 * calendar days UNDERSTATE every lead time, so a plan built on them says the
 * floor has more time than it does.
 *
 * The factory calendar this should really read does not exist yet. `holidays`
 * (0256) stores dates and ranges but nothing consults it, there is no weekly-off
 * master at all, and no `isWorkingDay` existed anywhere before this file. So
 * Sunday is hardcoded and **every function here takes an optional holiday set**:
 * wiring the master later is a caller change, not a signature change. A default
 * that silently read an empty master would be worse than a hardcoded Sunday —
 * it would look configured and behave like calendar days.
 *
 * ## STRINGS, NOT DATES
 *
 * `lib/calendar.ts` owns the arithmetic and its header says why: a Postgres
 * `date` is a plain `YYYY-MM-DD`, and `new Date("2026-08-23")` is UTC midnight,
 * so a local-time reader answers for the previous day west of UTC. Nothing here
 * constructs a `Date`. `ta-plan-screen.tsx` carried a second, local `addDays`
 * doing `new Date(iso + "T00:00:00").setDate(...)` — wall-clock arithmetic, the
 * exact technique `lib/calendar.ts` exists to replace — and this module is what
 * lets that copy be deleted rather than added to.
 *
 * ## NULL IS AN ANSWER. A GUESSED DATE IS NOT.
 *
 * The convention the BOM engines set, and it matters more here: a wrong date is
 * a delivery that misses, and a plan is read as a promise. Every branch that
 * cannot answer returns a `Refusal` carrying the sentence the screen prints.
 */

import { addDays, dayOfWeek, daysBetween, today } from "@/lib/calendar";
import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";

export type { Refusal };
export { isRefusal };

/** 0 = Sunday, as `dayOfWeek` reports it. */
const SUNDAY = 0;

/**
 * A runaway guard, in calendar days. Ten years back from any real delivery date
 * is far past absurd, so hitting it means the working-day test can never be
 * satisfied — a holiday set covering every day, which is a configuration
 * mistake rather than a schedule. Without it that is an infinite loop in a
 * function the screen calls on every keystroke.
 */
const MAX_WALK = 3650;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a day the factory works?
 *
 * @param holidays optional set of `YYYY-MM-DD` the factory is closed. A RANGE in
 *   the `holidays` master must be expanded to its member dates by the caller —
 *   this takes a set of days, not a set of ranges, so the rule stays one line
 *   and the expansion stays testable on its own.
 */
export function isWorkingDay(iso: string, holidays?: ReadonlySet<string>): boolean {
  if (dayOfWeek(iso) === SUNDAY) return false;
  return !holidays?.has(iso);
}

/**
 * The nearest working day at or before `iso`.
 *
 * "At or before", not "before" — a date already on a working day is returned
 * unchanged. A function that always moved would walk a whole ladder backwards
 * one day per step for no reason.
 */
export function previousWorkingDay(
  iso: string,
  holidays?: ReadonlySet<string>,
): string | Refusal {
  if (!ISO.test(iso)) return { refused: `"${iso}" is not a date` };
  let at = iso;
  for (let i = 0; i <= MAX_WALK; i++) {
    if (isWorkingDay(at, holidays)) return at;
    at = addDays(at, -1);
  }
  return { refused: "No working day found — check the holiday calendar" };
}

/**
 * Step back `days` WORKING days from `iso`.
 *
 * ## WHAT "3 WORKING DAYS BACK" MEANS, PRECISELY
 *
 * Three days of work must FIT before the anchor, so three working days are
 * counted off, and days the factory is closed are stepped over without being
 * counted. From Wednesday that lands on Friday, not Sunday.
 *
 * ## ZERO IS THE ANCHOR ITSELF, UNSNAPPED
 *
 * `days = 0` returns `iso` unchanged even if it is a Sunday, and that is
 * deliberate: the delivery date is a business fact the buyer fixed, not
 * something this module may quietly move to the previous Friday. Only DERIVED
 * dates are pulled onto working days. A caller that wants the anchor snapped
 * asks for it with `previousWorkingDay`.
 */
export function subtractWorkingDays(
  iso: string,
  days: number,
  holidays?: ReadonlySet<string>,
): string | Refusal {
  if (!ISO.test(iso)) return { refused: `"${iso}" is not a date` };
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    return { refused: "Lead time must be a whole number of days" };
  }
  // A NEGATIVE LEAD TIME IS NOT A SCHEDULE. It would push a process AFTER the
  // task it feeds, which reads as an ordinary date and is a plan that cannot be
  // executed. Refused rather than absorbed.
  if (days < 0) return { refused: "Lead time cannot be negative" };
  if (days === 0) return iso;

  let at = iso;
  let left = days;
  for (let i = 0; left > 0 && i < MAX_WALK; i++) {
    at = addDays(at, -1);
    if (isWorkingDay(at, holidays)) left--;
  }
  if (left > 0) return { refused: "No working day found — check the holiday calendar" };
  return at;
}

/**
 * Step FORWARD `days` working days from `iso` — `subtractWorkingDays` mirrored.
 *
 * The grid also asks the forward question ("this starts here and needs 3 days,
 * when does it end?"), and the two directions must count the same way or one
 * screen holds two notions of a day: a plan scheduled backward and then nudged
 * forward by one edit would disagree with itself by however many Sundays the
 * span contains. Same guards, same refusals, same walk.
 */
export function addWorkingDays(
  iso: string,
  days: number,
  holidays?: ReadonlySet<string>,
): string | Refusal {
  if (!ISO.test(iso)) return { refused: `"${iso}" is not a date` };
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    return { refused: "Lead time must be a whole number of days" };
  }
  if (days < 0) return { refused: "Lead time cannot be negative" };
  if (days === 0) return iso;

  let at = iso;
  let left = days;
  for (let i = 0; left > 0 && i < MAX_WALK; i++) {
    at = addDays(at, 1);
    if (isWorkingDay(at, holidays)) left--;
  }
  if (left > 0) return { refused: "No working day found — check the holiday calendar" };
  return at;
}

/** One process in the ladder, as much of it as the scheduler needs. */
export type ScheduleStep = {
  /** The caller's identifier — a `ta_style_activities.id` or an activity id. */
  key: string;
  /** What the operator calls it. Carried so a refusal can NAME the process. */
  label: string;
  /**
   * Working days this process needs, counted back from the step after it.
   * `ta_style_activities.days_required` is the template's figure and
   * `ta_plan_activities.days_required` is the per-order override — resolving
   * between them is the caller's job, exactly as `consumptionFor` resolves a
   * BOM slice against its line.
   */
  days: number | null;
};

/** A step with the date the plan puts it on. */
export type ScheduledStep = ScheduleStep & {
  days: number;
  /** The date this process must be COMPLETE by, as `YYYY-MM-DD`. */
  date: string;
  /**
   * Calendar days from today. Negative means the date is already past — the plan
   * is late before it starts.
   */
  float: number;
};

export type Schedule = {
  steps: ScheduledStep[];
  /** The earliest date in the ladder — when work has to begin. */
  startDate: string;
  /**
   * Calendar days between today and `startDate`. NEGATIVE IS REPORTED, NEVER
   * CLAMPED: a chain that reaches past today means the order cannot be made on
   * time, and a date silently pulled forward to today is a plan claiming to be
   * achievable. The screen shows the shortfall; it does not hide it.
   */
  float: number;
};

/**
 * The whole ladder, from the delivery date backwards.
 *
 * `steps` are given in DOWNSTREAM-FIRST order — the task nearest delivery first,
 * Material In-House last — because that is the order the arithmetic runs in and
 * a list that has to be reversed before use is a list that will be reversed
 * twice by someone.
 *
 * Each step's date is `previous step's date − this step's days`, so the days are
 * cumulative down the chain, which is what "2 days before Packing" means.
 *
 * ## A MISSING LEAD TIME REFUSES AND NAMES THE PROCESS
 *
 * `days: null` is a row the operator has not filled in. Treating it as 0 would
 * silently collapse two processes onto one date and the plan would still look
 * complete — the same "0 is not an answer" call the BOM engines make about a
 * quantity, on a figure that is a delivery promise instead of money.
 */
export function backwardSchedule(input: {
  deliveryDate: string | null | undefined;
  steps: readonly ScheduleStep[];
  holidays?: ReadonlySet<string>;
  /** Overridable so the vectors do not depend on the day they run. */
  now?: string;
}): Schedule | Refusal {
  const delivery = (input.deliveryDate ?? "").trim();
  if (!delivery) return { refused: "Enter the delivery date before scheduling" };
  if (!ISO.test(delivery)) return { refused: `"${delivery}" is not a date` };
  if (input.steps.length === 0) {
    return { refused: "No activities to schedule — add them to the plan first" };
  }

  const now = input.now ?? today();
  const out: ScheduledStep[] = [];
  let at = delivery;

  for (const s of input.steps) {
    const days = s.days;
    if (days == null || !Number.isFinite(days)) {
      return { refused: `${s.label || "A process"}: enter how many days it needs` };
    }
    const next = subtractWorkingDays(at, days, input.holidays);
    if (isRefusal(next)) {
      // The walk's own refusals do not know which process they are about, and a
      // sentence naming neither the row nor the reason sends the operator
      // hunting through the whole ladder.
      return { refused: `${s.label || "A process"}: ${next.refused}` };
    }
    at = next;
    out.push({ ...s, days, date: at, float: daysBetween(now, at) });
  }

  return { steps: out, startDate: at, float: daysBetween(now, at) };
}

/**
 * Expand the `holidays` master into the set these functions take.
 *
 * A row is a single date or, when `is_date_range`, an inclusive span. Kept here
 * rather than in the service so it is vectored: an off-by-one on the range end
 * is a day the factory is open being treated as closed, which moves every date
 * in every plan by one and looks entirely ordinary.
 *
 * A malformed row is SKIPPED, not refused — a bad holiday should not stop the
 * whole factory scheduling. That is the opposite call from a missing lead time,
 * and the difference is whose answer is wrong: a lead time belongs to the plan
 * being written, a holiday belongs to a master somebody else maintains.
 */
export function holidaySet(
  rows: readonly { holiday_date: string | null; end_date: string | null }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const from = (r.holiday_date ?? "").trim();
    if (!ISO.test(from)) continue;
    const to = (r.end_date ?? "").trim();
    if (!ISO.test(to) || daysBetween(from, to) < 0) {
      out.add(from);
      continue;
    }
    const span = daysBetween(from, to);
    if (span > 366) continue; // a "holiday" longer than a year is a bad row
    for (let i = 0; i <= span; i++) out.add(addDays(from, i));
  }
  return out;
}
