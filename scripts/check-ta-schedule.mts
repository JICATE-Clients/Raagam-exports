/**
 * Vectors for `lib/ta/schedule.ts` — Time & Action backward scheduling.
 *
 * ## WHAT MAKES A VECTOR EARN ITS PLACE HERE
 *
 * The same standard `check-bom-requirement.mts` sets: a case where two plausible
 * implementations DISAGREE. A ladder that never crosses a Sunday passes under
 * calendar-day arithmetic and working-day arithmetic alike, so it proves
 * nothing. Every date below is chosen against a real weekday:
 *
 *     2026-08-23 is a SUNDAY
 *     2026-08-24 is a Monday
 *     2026-08-21 is a Friday
 *
 * ## AND WHY THE DATES ARE HARD-CODED
 *
 * `backwardSchedule` takes `now` so the float figures do not depend on the day
 * the suite runs. A vector that passes on Tuesday and fails on Monday teaches
 * the next reader to ignore the suite.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver does not read them.
 */
import {
  addWorkingDays,
  backwardSchedule,
  holidaySet,
  isWorkingDay,
  previousWorkingDay,
  subtractWorkingDays,
  isRefusal,
} from "../lib/ta/schedule.ts";
import { dayOfWeek, daysBetween } from "../lib/calendar.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Asserts a value is NOT something — the wrong answer a plausible
 *  implementation gives. A vector that only states the right answer cannot say
 *  which wrong one it was guarding against. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const refusalOf = (v: unknown): string | null =>
  isRefusal(v) ? v.refused : null;

// ---------------------------------------------------------------------------
// 0. The fixture's own premise
//
// If these fail, every vector below is measuring the wrong thing.
// ---------------------------------------------------------------------------

check("2026-08-23 really is a Sunday", dayOfWeek("2026-08-23"), 0);
check("2026-08-24 really is a Monday", dayOfWeek("2026-08-24"), 1);
check("2026-08-21 really is a Friday", dayOfWeek("2026-08-21"), 5);

// ---------------------------------------------------------------------------
// 1. Working days
// ---------------------------------------------------------------------------

check("a Sunday is not a working day", isWorkingDay("2026-08-23"), false);
check("a Monday is", isWorkingDay("2026-08-24"), true);
check("a Saturday IS a working day here", isWorkingDay("2026-08-22"), true);
check(
  "a holiday is not, even on a weekday",
  isWorkingDay("2026-08-24", new Set(["2026-08-24"])),
  false,
);

check("a working day is returned unchanged", previousWorkingDay("2026-08-24"), "2026-08-24");
check("a Sunday steps back to Saturday", previousWorkingDay("2026-08-23"), "2026-08-22");
check(
  "a Sunday after a Saturday holiday steps back to Friday",
  previousWorkingDay("2026-08-23", new Set(["2026-08-22"])),
  "2026-08-21",
);

// ---------------------------------------------------------------------------
// 2. Stepping back — THE VECTOR THAT SEPARATES WORKING FROM CALENDAR DAYS
// ---------------------------------------------------------------------------

/*
 * Monday 24th, 3 days back. Calendar arithmetic says Friday the 21st. Working
 * days must skip Sunday the 23rd and land on THURSDAY the 20th — one full day
 * of float that a calendar-day plan silently spends.
 */
check("3 working days back from Monday clears the weekend", subtractWorkingDays("2026-08-24", 3), "2026-08-20");
refute(
  "…not the 21st, which is plain calendar subtraction",
  subtractWorkingDays("2026-08-24", 3),
  "2026-08-21",
);

check("1 working day back from Monday is Saturday", subtractWorkingDays("2026-08-24", 1), "2026-08-22");
check("2 working days back from Monday is Friday", subtractWorkingDays("2026-08-24", 2), "2026-08-21");

/*
 * ZERO IS THE ANCHOR, UNSNAPPED — even on a Sunday. The delivery date is the
 * buyer's fact; only derived dates are pulled onto working days.
 */
check("0 days returns the anchor untouched", subtractWorkingDays("2026-08-23", 0), "2026-08-23");
refute(
  "…it does not quietly snap the delivery date to Saturday",
  subtractWorkingDays("2026-08-23", 0),
  "2026-08-22",
);

/* Stepping back FROM a Sunday: the anchor is not counted, so 1 day back from
   Sunday the 23rd is Saturday the 22nd. */
check("1 day back from a Sunday is the Saturday", subtractWorkingDays("2026-08-23", 1), "2026-08-22");

check(
  "a holiday inside the span is stepped over too",
  subtractWorkingDays("2026-08-24", 3, new Set(["2026-08-21"])),
  "2026-08-19",
);

check(
  "a negative lead time refuses",
  refusalOf(subtractWorkingDays("2026-08-24", -1)),
  "Lead time cannot be negative",
);
check(
  "a fractional lead time refuses",
  refusalOf(subtractWorkingDays("2026-08-24", 1.5)),
  "Lead time must be a whole number of days",
);
check("a malformed anchor refuses", refusalOf(subtractWorkingDays("24/08/2026", 1)), '"24/08/2026" is not a date');

/*
 * FORWARD AND BACKWARD MUST COUNT THE SAME WAY. The grid asks both questions,
 * and if the two directions disagree a plan scheduled backward then nudged
 * forward by one edit contradicts itself by however many Sundays the span holds.
 * Friday + 1 working day is MONDAY only if Saturday is a working day here - it
 * is, so it is Saturday; and Saturday + 1 is Monday because Sunday is skipped.
 */
check("Friday + 1 working day is Saturday", addWorkingDays("2026-08-21", 1), "2026-08-22");
check("Saturday + 1 skips Sunday to Monday", addWorkingDays("2026-08-22", 1), "2026-08-24");
refute("...not Sunday the 23rd", addWorkingDays("2026-08-22", 1), "2026-08-23");
check(
  "forward then back returns to the start",
  (() => {
    const f = addWorkingDays("2026-08-14", 8);
    return typeof f === "string" ? subtractWorkingDays(f, 8) : f;
  })(),
  "2026-08-14",
);
check("0 days forward is the anchor", addWorkingDays("2026-08-23", 0), "2026-08-23");
check(
  "a negative lead time refuses forward too",
  refusalOf(addWorkingDays("2026-08-24", -1)),
  "Lead time cannot be negative",
);

// ---------------------------------------------------------------------------
// 3. The ladder
// ---------------------------------------------------------------------------

const LADDER = [
  { key: "insp", label: "Final Inspection", days: 1 },
  { key: "pack", label: "Packing", days: 2 },
  { key: "iron", label: "Ironing", days: 2 },
  { key: "qa", label: "Checking", days: 3 },
];

/*
 * Delivery Monday 2026-08-24, walked back through the ladder. Every hop is
 * counted in working days, so the two weekends inside the span push the start
 * two days earlier than calendar arithmetic would.
 */
const plan = backwardSchedule({ deliveryDate: "2026-08-24", steps: LADDER, now: "2026-08-01" });

check(
  "each process lands on its own date",
  isRefusal(plan) ? plan.refused : plan.steps.map((s) => [s.label, s.date]),
  [
    ["Final Inspection", "2026-08-22"],
    ["Packing", "2026-08-20"],
    ["Ironing", "2026-08-18"],
    ["Checking", "2026-08-14"],
  ],
);

check(
  "the start date is the last step's date",
  isRefusal(plan) ? plan.refused : plan.startDate,
  "2026-08-14",
);

/* THE LADDER IS CUMULATIVE. 1+2+2+3 = 8 working days, and the calendar span is
   LONGER because two Sundays (the 16th and the 23rd) sit inside it — 10 days,
   not 8. If these ever match, the working-day walk has stopped skipping. */
check("8 working days span 10 calendar days here", daysBetween("2026-08-14", "2026-08-24"), 10);
refute("…not 8, which would mean no day was skipped", daysBetween("2026-08-14", "2026-08-24"), 8);

check("float is measured from `now`", isRefusal(plan) ? null : plan.float, 13);

// ---------------------------------------------------------------------------
// 4. A plan that is already late
//
// The assumption written into `Schedule.float`: a chain reaching past today
// reports the shortfall rather than clamping. A date pulled forward to today is
// a plan claiming to be achievable when it is not.
// ---------------------------------------------------------------------------

const late = backwardSchedule({ deliveryDate: "2026-08-24", steps: LADDER, now: "2026-08-20" });
check("a late plan reports negative float", isRefusal(late) ? null : late.float, -6);
refute("…it does not clamp to 0", isRefusal(late) ? null : late.float, 0);
check(
  "…and the past dates are still reported as they fall",
  isRefusal(late) ? null : late.startDate,
  "2026-08-14",
);
refute("…not pulled forward to today", isRefusal(late) ? null : late.startDate, "2026-08-20");

// ---------------------------------------------------------------------------
// 5. Refusals
// ---------------------------------------------------------------------------

check(
  "no delivery date refuses",
  refusalOf(backwardSchedule({ deliveryDate: null, steps: LADDER })),
  "Enter the delivery date before scheduling",
);
check(
  "an empty ladder refuses",
  refusalOf(backwardSchedule({ deliveryDate: "2026-08-24", steps: [] })),
  "No activities to schedule — add them to the plan first",
);
check(
  "a blank lead time refuses and NAMES the process",
  refusalOf(
    backwardSchedule({
      deliveryDate: "2026-08-24",
      steps: [{ key: "a", label: "Sewing", days: null }],
    }),
  ),
  "Sewing: enter how many days it needs",
);
refute(
  "…a blank lead time is not treated as 0",
  (() => {
    const r = backwardSchedule({
      deliveryDate: "2026-08-24",
      steps: [{ key: "a", label: "Sewing", days: null }],
    });
    return isRefusal(r) ? null : r.startDate;
  })(),
  "2026-08-24",
);

// ---------------------------------------------------------------------------
// 6. The holiday master's ranges
// ---------------------------------------------------------------------------

check(
  "a single-date holiday is one day",
  [...holidaySet([{ holiday_date: "2026-08-24", end_date: null }])],
  ["2026-08-24"],
);
check(
  "a range is INCLUSIVE of its end",
  [...holidaySet([{ holiday_date: "2026-08-24", end_date: "2026-08-26" }])],
  ["2026-08-24", "2026-08-25", "2026-08-26"],
);
refute(
  "…the end day is not dropped",
  [...holidaySet([{ holiday_date: "2026-08-24", end_date: "2026-08-26" }])],
  ["2026-08-24", "2026-08-25"],
);
check(
  "a backwards range falls back to the single day",
  [...holidaySet([{ holiday_date: "2026-08-24", end_date: "2026-08-01" }])],
  ["2026-08-24"],
);
check("a malformed row is skipped, not refused", [...holidaySet([{ holiday_date: "", end_date: null }])], []);

check(
  "a scheduled ladder reads the holiday set",
  (() => {
    const r = backwardSchedule({
      deliveryDate: "2026-08-24",
      steps: [{ key: "a", label: "Packing", days: 1 }],
      holidays: holidaySet([{ holiday_date: "2026-08-22", end_date: null }]),
      now: "2026-08-01",
    });
    return isRefusal(r) ? r.refused : r.startDate;
  })(),
  "2026-08-21",
);

console.log(failed === 0 ? "\nOK — every T&A schedule vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
