/**
 * Vectors for `lib/ta/*` — Time & Action backward scheduling (`schedule.ts`) and
 * the TA Style template copy (`template.ts`).
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
import {
  applyWarning,
  templateActivities,
  templateSummary,
  type TemplateHeader,
} from "../lib/ta/template.ts";
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

// ---------------------------------------------------------------------------
// 7. Copying a TA Style template into a plan (0453)
//
// The two tables existed for months with nothing connecting them. What the copy
// must get right is not the arithmetic - there barely is any - but WHAT IT
// CARRIES and what it refuses.
// ---------------------------------------------------------------------------

const TPL: TemplateHeader = {
  id: "t1",
  code: "TAS-0001",
  description: "Knit tee, 60 day",
  lead_days: 5,
  start_days: 2,
  activities: [
    { sno: 10, activity_id: "a-cut", from_activity_id: null, days_required: 1 },
    { sno: 20, activity_id: "a-sew", from_activity_id: "a-cut", days_required: 6 },
    { sno: 30, activity_id: "a-pack", from_activity_id: "a-sew", days_required: 2 },
  ],
};

const copied = templateActivities(TPL);

check(
  "the ladder copies in order, keeping each row's predecessor",
  isRefusal(copied) ? copied.refused : copied.map((r) => [r.activity_id, r.from_activity_id, r.days_required]),
  [
    ["a-cut", null, 1],
    ["a-sew", "a-cut", 6],
    ["a-pack", "a-sew", 2],
  ],
);

/* SNO IS RE-NUMBERED FROM 1. The template's own numbering has gaps (10/20/30 -
   rows get deleted and the rest are not renumbered), and carrying those across
   makes every later insert guess a free number in a grid read back sorted by
   sno. */
check(
  "sno is renumbered 1..n, not carried",
  isRefusal(copied) ? copied.refused : copied.map((r) => r.sno),
  [1, 2, 3],
);
refute(
  "...the template's gapped numbering is not carried",
  isRefusal(copied) ? copied.refused : copied.map((r) => r.sno),
  [10, 20, 30],
);

/* AN OUT-OF-ORDER TEMPLATE STILL COPIES IN ORDER. `ta_style_activities` is read
   back sorted, but nothing stops a caller handing rows over unsorted. */
check(
  "rows are sorted by sno before copying, not trusted in array order",
  (() => {
    const r = templateActivities({
      ...TPL,
      activities: [
        { sno: 30, activity_id: "a-pack", from_activity_id: null, days_required: 2 },
        { sno: 10, activity_id: "a-cut", from_activity_id: null, days_required: 1 },
      ],
    });
    return isRefusal(r) ? r.refused : r.map((x) => x.activity_id);
  })(),
  ["a-cut", "a-pack"],
);

/* NO DATES COME ACROSS, and that is the design rather than an omission: a
   template is reusable precisely because it is not tied to one delivery date.
   Dating the ladder is `backwardSchedule`'s separate, re-runnable job. */
check(
  "no row arrives carrying a date",
  isRefusal(copied) ? null : copied.every((r) => r.start_date === null && r.end_date === null),
  true,
);

/* A ROW WITH NO ACTIVITY REFUSES. Copied, it becomes a plan row with an empty
   Activity cell - which reads as one the PLANNER forgot, so they fill it in and
   silently diverge from the template they thought they applied. */
check(
  "a template row with no activity refuses, naming the row",
  refusalOf(
    templateActivities({
      ...TPL,
      activities: [
        { sno: 10, activity_id: "a-cut", from_activity_id: null, days_required: 1 },
        { sno: 20, activity_id: null, from_activity_id: null, days_required: 3 },
      ],
    }),
  ),
  "TAS-0001 has a row with no activity (row 2) — fix the template first",
);
check(
  "an empty template refuses rather than clearing the grid",
  refusalOf(templateActivities({ ...TPL, activities: [] })),
  "TAS-0001 has no activities to copy",
);

/* ZERO DAYS IS A REAL ANSWER, unlike a missing activity: two activities can
   share a date, and the column is `not null default 0`, so a template that never
   touched the field is ordinary. `backwardSchedule` refuses a NULL later, which
   is the right place - by then the operator is asking for dates. */
check(
  "a zero-day row copies rather than refusing",
  (() => {
    const r = templateActivities({
      ...TPL,
      activities: [{ sno: 1, activity_id: "a-cut", from_activity_id: null, days_required: 0 }],
    });
    return isRefusal(r) ? r.refused : r[0].days_required;
  })(),
  0,
);
check(
  "a null days_required lands as 0, not null",
  (() => {
    const r = templateActivities({
      ...TPL,
      activities: [{ sno: 1, activity_id: "a-cut", from_activity_id: null, days_required: null }],
    });
    return isRefusal(r) ? r.refused : r[0].days_required;
  })(),
  0,
);

/* THE CONFIRM NAMES BOTH COUNTS. "Are you sure?" tells the planner nothing they
   did not know; how many rows go and how many arrive is a decision. */
check("nothing to warn about on an empty grid", applyWarning(TPL, 0), null);
check(
  "the warning names what is lost and what arrives",
  applyWarning(TPL, 4),
  "This replaces the 4 activities already on this plan with the 3 from TAS-0001. Any dates typed against them are lost.",
);
check(
  "one row is singular",
  applyWarning(TPL, 1)?.startsWith("This replaces the 1 activity already"),
  true,
);

/* THE SUMMARY REPRODUCES ta-style-screen's OWN FOOTER SUM. lead + start + work,
   and the two screens must not print different totals for one template. */
check("the template summary totals as its own screen does", templateSummary(TPL), {
  activities: 3,
  workDays: 9,
  leadDays: 5,
  startDays: 2,
  targetDays: 16,
});
refute(
  "...targetDays is not just the work days",
  templateSummary(TPL).targetDays,
  9,
);

console.log(failed === 0 ? "\nOK — every T&A schedule vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
