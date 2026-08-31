/**
 * Vectors for `lib/orders/ta/order-ladder.ts` — the order's T&A ladder.
 *
 * ## WHAT THIS SUITE IS ACTUALLY GUARDING
 *
 * The arithmetic is `lib/ta/schedule.ts`'s and is vectored by
 * `npm run check:ta-schedule`. What is new here is small and every piece of it
 * is silent when wrong — which is exactly the shape that needs vectors:
 *
 *   - **Which date the ladder hangs off.** The Quantities grid is per
 *     country/consignee, so there are N `earlier_shipment_date`s. Taking the
 *     first, or the header's `delivery_date` while an earlier consignment sits
 *     in the grid, produces a complete and plausible plan that is late for the
 *     first lorry. Nothing on screen says which date was used unless
 *     `anchor.source` says it, so the wrong one is invisible.
 *   - **Which way round the list runs.** `backwardSchedule` takes steps
 *     downstream-first; the grid renders execution order. A missing reversal
 *     dates the ladder inside out and every date still looks like a date. So
 *     the vectors below assert the ORDER of the output, not only its contents —
 *     a suite that checked the set of dates would pass on a ladder scheduled
 *     backwards.
 *
 * ## THE STANDARD A VECTOR HAS TO MEET
 *
 * `check-bom-requirement.mts`'s: a case where two plausible implementations
 * DISAGREE. So every ladder below either crosses a Sunday or is stated as the
 * client stated it, and each `refute` names the wrong answer being guarded
 * against — a vector that only states the right answer cannot say which wrong
 * one it was written for.
 *
 * ## AND THE DATES ARE HARD-CODED, INCLUDING `now`
 *
 * `orderTaLadder` takes `now` so the float figures do not depend on the day the
 * suite runs. A vector that passes on Tuesday and fails on Monday teaches the
 * next reader to ignore the suite.
 *
 *     2026-10-10 is a SATURDAY — a working day here; Sunday is the only one off
 *     2026-10-09 is a Friday
 *     2026-10-04 is a SUNDAY
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module imports
 * the `@/lib/...` alias at runtime and Node's ESM resolver does not read
 * tsconfig `paths`. The import is not incidental and must not be flattened to
 * suit a runner — the whole point of the file is that it shares ONE scheduler
 * with the rest of the app.
 */
import { orderTaLadder, isRefusal } from "../lib/orders/ta/order-ladder.ts";
import { dayOfWeek } from "../lib/calendar.ts";

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
 *  implementation gives. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const refusalOf = (v: unknown): string | null => (isRefusal(v) ? v.refused : null);

type Row = { row_uid: string; activity_id: string | null; label: string; days_required: number | null };

const row = (uid: string, label: string, days: number | null): Row => ({
  row_uid: uid,
  activity_id: `act-${uid}`,
  label,
  days_required: days,
});

const dates = (v: unknown) =>
  isRefusal(v) ? v.refused : (v as { rows: { target_date: string }[] }).rows.map((r) => r.target_date);

// ---------------------------------------------------------------------------
// 0. The fixture's own premise
//
// If these fail, every vector below is measuring the wrong thing.
// ---------------------------------------------------------------------------

check("2026-10-10 really is a Saturday", dayOfWeek("2026-10-10"), 6);
check("2026-10-09 really is a Friday", dayOfWeek("2026-10-09"), 5);
check("2026-10-04 really is a Sunday", dayOfWeek("2026-10-04"), 0);

// ---------------------------------------------------------------------------
// 1. THE CLIENT'S OWN PUBLISHED FIGURES
//
// Stated by the client and reproduced verbatim: delivery 2026-10-10, Final
// Inspection 1 day back is 2026-10-09, Packing 2 days back is 2026-10-07.
// Sewing's 4 days are this suite's addition and are the Sunday crossing (§2).
//
// The rows are given in EXECUTION order, which is how the grid holds them.
// ---------------------------------------------------------------------------

const LADDER: Row[] = [
  row("r-sew", "Sewing", 4),
  row("r-pack", "Packing", 2),
  row("r-insp", "Final Inspection", 1),
];

const QTY_10 = [{ earlier_shipment_date: "2026-10-10" }];

const plan = orderTaLadder({
  rows: LADDER,
  quantities: QTY_10,
  deliveryDate: null,
  now: "2026-09-01",
});

check(
  "the client's own figures, activity by activity",
  isRefusal(plan) ? plan.refused : plan.rows.map((r) => [r.label, r.target_date]),
  [
    ["Sewing", "2026-10-02"],
    ["Packing", "2026-10-07"],
    ["Final Inspection", "2026-10-09"],
  ],
);

check("the anchor is reported, and where it came from", isRefusal(plan) ? null : plan.anchor, {
  date: "2026-10-10",
  source: "earlier_shipment",
});

check("work begins at the earliest date in the ladder", isRefusal(plan) ? null : plan.startDate, "2026-10-02");
check("float is measured from `now`, not from the day this runs", isRefusal(plan) ? null : plan.float, 31);

/* Each row carries its OWN float, not the ladder's. The dashboard reads the
   per-row figure to decide what is due; one number copied down every row would
   make every activity on the order look equally urgent. */
check(
  "each row carries its own float",
  isRefusal(plan) ? null : plan.rows.map((r) => r.float),
  [31, 36, 38],
);

/* THE ROW IS CARRIED WHOLE. `row_uid` is what an `actual_date` entered on the
   dashboard weeks later is merged back onto (§1.1 of the contract), so a
   scheduler that rebuilt rows instead of spreading them would hand the writer
   fresh uids and destroy every completion record on the order. */
check(
  "row_uid and activity_id come back untouched",
  isRefusal(plan) ? null : plan.rows.map((r) => [r.row_uid, r.activity_id]),
  [
    ["r-sew", "act-r-sew"],
    ["r-pack", "act-r-pack"],
    ["r-insp", "act-r-insp"],
  ],
);

// ---------------------------------------------------------------------------
// 2. THE SUNDAY CROSSING — the vector that separates working from calendar days
//
// Sewing's 4 days back from Wednesday 2026-10-07 must step OVER Sunday the 4th
// and land on Friday the 2nd. Calendar arithmetic says Saturday the 3rd: one
// full day of float a calendar-day plan silently spends.
// ---------------------------------------------------------------------------

check("Sewing clears the Sunday", isRefusal(plan) ? null : plan.rows[0].target_date, "2026-10-02");
refute(
  "…not the 3rd, which is plain calendar subtraction",
  isRefusal(plan) ? null : plan.rows[0].target_date,
  "2026-10-03",
);
refute("…and not the Sunday itself", isRefusal(plan) ? null : plan.rows[0].target_date, "2026-10-04");

/* SATURDAY IS A WORKING DAY HERE, and the anchor is one. It is NOT snapped back
   to Friday: the shipment date is a fact somebody else fixed, and only DERIVED
   dates are pulled onto working days (`schedule.ts`, "zero is the anchor,
   unsnapped"). */
check("the anchor is not snapped off its Saturday", isRefusal(plan) ? null : plan.anchor.date, "2026-10-10");

// ---------------------------------------------------------------------------
// 3. THE ORDER OF THE OUTPUT — the double-reversal guard
//
// `backwardSchedule` takes steps downstream-first; the grid renders execution
// order. Both reversals live in `orderTaLadder` and nowhere else. Drop either
// one and the ladder is dated inside out — Fabric Plan lands the day before
// shipment and Shipment lands months early — while every individual date still
// reads as an ordinary date.
// ---------------------------------------------------------------------------

const FULL: Row[] = [
  row("a1", "Fabric Plan", 3),
  row("a2", "Accessories BOM", 2),
  row("a3", "Yarn Purchase", 5),
  row("a4", "Knitting", 6),
  row("a5", "Dyeing", 4),
  row("a6", "Cutting", 2),
  row("a7", "Sewing", 8),
  row("a8", "Packing", 2),
  row("a9", "Inspection", 1),
  row("a10", "Shipment", 1),
];

const full = orderTaLadder({
  rows: FULL,
  quantities: QTY_10,
  deliveryDate: null,
  now: "2026-09-01",
});

check(
  "the rows come back in the order they went in",
  isRefusal(full) ? null : full.rows.map((r) => r.label),
  FULL.map((r) => r.label),
);

/* Dates ASCEND down the grid: the first row is the earliest work and the last
   is nearest shipment. A ladder missing the outbound reversal descends. */
check(
  "dates ascend down the grid",
  isRefusal(full) ? null : full.rows.every((r, i, a) => i === 0 || a[i - 1].target_date <= r.target_date),
  true,
);

/* The specific wrong answer: with the outbound reversal dropped, row 1 (Fabric
   Plan) takes Shipment's date — one working day off the anchor — and row 10
   (Shipment) takes the start of the whole plan. */
check(
  "the LAST row is the one nearest the anchor",
  isRefusal(full) ? null : full.rows[9].target_date,
  "2026-10-09",
);
refute(
  "…the FIRST row is not the date nearest shipment",
  isRefusal(full) ? null : full.rows[0].target_date,
  "2026-10-09",
);
check(
  "…the first row is where work starts",
  isRefusal(full) ? null : full.rows[0].target_date === full.startDate,
  true,
);

// ---------------------------------------------------------------------------
// 4. THE ANCHOR IS THE EARLIEST OF N
//
// The Quantities grid is per country/consignee and each row carries its own
// date. The whole order has to be ready for the FIRST lorry.
//
// The fixture is built so three plausible implementations disagree: the rows are
// deliberately NOT in date order (so "the first one" is wrong), they include a
// null and a blank (so "the last one" and "count them" are wrong), and the
// header `delivery_date` is EARLIER than all of them (so a fallback that fires
// when it should not is visible rather than coincidentally right).
// ---------------------------------------------------------------------------

const N_ROWS = [
  { earlier_shipment_date: "2026-10-20" },
  { earlier_shipment_date: null },
  { earlier_shipment_date: "2026-10-10" },
  { earlier_shipment_date: "   " },
  { earlier_shipment_date: "2026-11-01" },
];

const ofN = orderTaLadder({
  rows: LADDER,
  quantities: N_ROWS,
  deliveryDate: "2026-09-15",
  now: "2026-09-01",
});

check("the earliest shipment date wins", isRefusal(ofN) ? null : ofN.anchor, {
  date: "2026-10-10",
  source: "earlier_shipment",
});
refute("…not the first row in the grid", isRefusal(ofN) ? null : ofN.anchor.date, "2026-10-20");
refute("…not the last", isRefusal(ofN) ? null : ofN.anchor.date, "2026-11-01");
refute("…and not the header delivery date", isRefusal(ofN) ? null : ofN.anchor.date, "2026-09-15");
check("the whole ladder hangs off it", dates(ofN), ["2026-10-02", "2026-10-07", "2026-10-09"]);

// ---------------------------------------------------------------------------
// 5. THE DELIVERY-DATE FALLBACK, AND `anchor.source` SAYING SO
//
// Same ladder, same dates, different provenance — which is the whole reason
// `source` is reported. A screen showing the ladder without saying what it hangs
// off is one the operator cannot check.
// ---------------------------------------------------------------------------

const fallback = orderTaLadder({
  rows: LADDER,
  quantities: [{ earlier_shipment_date: null }, { earlier_shipment_date: "" }, { earlier_shipment_date: "  " }],
  deliveryDate: "2026-10-10",
  now: "2026-09-01",
});

check("with no shipment date it falls back to delivery", isRefusal(fallback) ? null : fallback.anchor, {
  date: "2026-10-10",
  source: "delivery",
});
check("…and the ladder is identical", dates(fallback), dates(plan));
refute(
  "…the source is not reported as a shipment date",
  isRefusal(fallback) ? null : fallback.anchor.source,
  "earlier_shipment",
);

/* An EMPTY quantities grid is the same case as one full of blanks. */
check(
  "an empty quantities grid falls back too",
  (() => {
    const r = orderTaLadder({ rows: LADDER, quantities: [], deliveryDate: "2026-10-10", now: "2026-09-01" });
    return isRefusal(r) ? r.refused : r.anchor.source;
  })(),
  "delivery",
);

// ---------------------------------------------------------------------------
// 6. A PLAN THAT IS ALREADY LATE
//
// `Schedule.float`'s rule reaching this surface: a chain reaching past today
// reports the shortfall rather than clamping. A start date pulled forward to
// today is a plan claiming to be achievable when the order cannot be made.
// ---------------------------------------------------------------------------

const late = orderTaLadder({ rows: LADDER, quantities: QTY_10, deliveryDate: null, now: "2026-10-05" });

check("a late plan reports negative float", isRefusal(late) ? null : late.float, -3);
refute("…it does not clamp to 0", isRefusal(late) ? null : late.float, 0);
check("…the past date is still reported as it falls", isRefusal(late) ? null : late.startDate, "2026-10-02");
refute("…not pulled forward to today", isRefusal(late) ? null : late.startDate, "2026-10-05");
check(
  "…and the row that is already past says so",
  isRefusal(late) ? null : late.rows.map((r) => r.float),
  [-3, 2, 4],
);

// ---------------------------------------------------------------------------
// 7. REFUSALS ARE SENTENCES
// ---------------------------------------------------------------------------

/* NO ANCHOR AT ALL. The sentence names the field and the tab, because the
   operator is on the T&A tab and the thing to fix is on another one. */
check(
  "neither a shipment date nor a delivery date refuses",
  refusalOf(orderTaLadder({ rows: LADDER, quantities: [{ earlier_shipment_date: null }], deliveryDate: null })),
  "Enter the Earlier Shipment Date on the Quantities tab before scheduling",
);
check(
  "a blank delivery date is the same as none",
  refusalOf(orderTaLadder({ rows: LADDER, quantities: [], deliveryDate: "   " })),
  "Enter the Earlier Shipment Date on the Quantities tab before scheduling",
);

/* A MISSING LEAD TIME REFUSES BY NAME, and the sentence is `backwardSchedule`'s
   own, passed through rather than restated. Two sentences for one fact is how
   they drift apart. */
check(
  "a blank Days refuses and NAMES the activity",
  refusalOf(
    orderTaLadder({
      rows: [row("r-sew", "Sewing", 4), row("r-knit", "Knitting", null), row("r-insp", "Final Inspection", 1)],
      quantities: QTY_10,
      deliveryDate: null,
    }),
  ),
  "Knitting: enter how many days it needs",
);
refute(
  "…it does not name whichever row happens to be first",
  refusalOf(
    orderTaLadder({
      rows: [row("r-sew", "Sewing", 4), row("r-knit", "Knitting", null), row("r-insp", "Final Inspection", 1)],
      quantities: QTY_10,
      deliveryDate: null,
    }),
  ),
  "Sewing: enter how many days it needs",
);
refute(
  "…and a blank Days is never treated as 0",
  (() => {
    const r = orderTaLadder({
      rows: [row("r-knit", "Knitting", null)],
      quantities: QTY_10,
      deliveryDate: null,
    });
    return isRefusal(r) ? null : r.startDate;
  })(),
  "2026-10-10",
);

check(
  "an empty ladder refuses",
  refusalOf(orderTaLadder({ rows: [], quantities: QTY_10, deliveryDate: null })),
  "No activities to schedule — add them to the plan first",
);

/* A MALFORMED SHIPMENT DATE REFUSES RATHER THAN BEING SKIPPED, and that is what
   makes earliest-of-N correct: `min` over YYYY-MM-DD strings is a chronological
   comparison only while every candidate is one. Silently dropping the bad value
   would pick a later anchor and date the whole ladder off it. */
check(
  "a malformed shipment date refuses",
  refusalOf(
    orderTaLadder({
      rows: LADDER,
      quantities: [{ earlier_shipment_date: "10/10/2026" }, { earlier_shipment_date: "2026-10-20" }],
      deliveryDate: null,
    }),
  ),
  '"10/10/2026" is not a date',
);
refute(
  "…it is not skipped in favour of the next row",
  (() => {
    const r = orderTaLadder({
      rows: LADDER,
      quantities: [{ earlier_shipment_date: "10/10/2026" }, { earlier_shipment_date: "2026-10-20" }],
      deliveryDate: null,
    });
    return isRefusal(r) ? null : r.anchor.date;
  })(),
  "2026-10-20",
);

/*
 * A DATE-SHAPED STRING THAT IS NOT A DAY REFUSES TOO — the other half of the
 * guard above, and the half that was missing until 2026-08-31.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` is a SHAPE test. `2026-02-31` passes it, and `Date.UTC`
 * rolls it silently to March 3 — so the ladder hung off a day that does not
 * exist while every derived date landed on a real one and nothing refused. The
 * derived dates STRADDLED the anchor, which is what makes it unspottable on
 * screen: Feb 27 and Mar 2 either side of an anchor printed as Feb 31.
 */
for (const [bad, why] of [
  ["2026-02-31", "a day February never has"],
  ["2026-13-01", "a thirteenth month"],
  ["2026-00-10", "a zeroth month — this one rolled back into DECEMBER 2025"],
] as const) {
  check(
    `${bad} refuses (${why})`,
    refusalOf(
      orderTaLadder({ rows: LADDER, quantities: [{ earlier_shipment_date: bad }], deliveryDate: null }),
    ),
    `"${bad}" is not a date`,
  );
}

/*
 * THE LEAP-YEAR PAIR IS WHAT PROVES THE ROUND TRIP.
 *
 * Every vector above would also pass against a hand-written month-length table.
 * These two cannot: 2026 is not a leap year and 2028 is, so Feb 29 must refuse
 * in one and schedule in the other. `isCalendarDate` gets that from rebuilding
 * the date through the same `Date.UTC` the scheduler uses, rather than from a
 * second statement of the calendar that is free to drift from the first.
 */
check(
  "2026-02-29 refuses — 2026 is not a leap year",
  refusalOf(
    orderTaLadder({
      rows: LADDER,
      quantities: [{ earlier_shipment_date: "2026-02-29" }],
      deliveryDate: null,
    }),
  ),
  '"2026-02-29" is not a date',
);
check(
  "2028-02-29 is accepted — 2028 IS a leap year",
  (() => {
    const r = orderTaLadder({
      rows: LADDER,
      quantities: [{ earlier_shipment_date: "2028-02-29" }],
      deliveryDate: null,
      now: "2028-01-01",
    });
    return isRefusal(r) ? r.refused : r.anchor.date;
  })(),
  "2028-02-29",
);
refute(
  "…the calendar test does not simply reject every 29th of February",
  (() => {
    const r = orderTaLadder({
      rows: LADDER,
      quantities: [{ earlier_shipment_date: "2028-02-29" }],
      deliveryDate: null,
      now: "2028-01-01",
    });
    return isRefusal(r) ? r.refused : r.anchor.date;
  })(),
  '"2028-02-29" is not a date',
);

/* The DELIVERY fallback is guarded by the same test — it is a second door into
   the same anchor, and a guard on one door only is not a guard. */
check(
  "a rolled-over delivery date refuses on the fallback path too",
  refusalOf(orderTaLadder({ rows: LADDER, quantities: [], deliveryDate: "2026-02-31" })),
  '"2026-02-31" is not a date',
);

/* THE ANCHOR IS TESTED FIRST. An order with no shipment date has nothing to
   schedule against however many activities it carries. */
check(
  "with no anchor AND no rows, the anchor is the sentence printed",
  refusalOf(orderTaLadder({ rows: [], quantities: [], deliveryDate: null })),
  "Enter the Earlier Shipment Date on the Quantities tab before scheduling",
);

// ---------------------------------------------------------------------------
// 8. THE HOLIDAY SET REACHES THE WALK
//
// Not arithmetic this file owns — but a `holidays` argument dropped on the way
// through is a ladder that looks configured and behaves like calendar days,
// which is the failure `schedule.ts`'s header refuses to allow a default for.
// ---------------------------------------------------------------------------

const holiday = orderTaLadder({
  rows: [row("r-pack", "Packing", 1)],
  quantities: QTY_10,
  deliveryDate: null,
  holidays: new Set(["2026-10-09"]),
  now: "2026-09-01",
});

check("a holiday inside the span is stepped over", isRefusal(holiday) ? null : holiday.rows[0].target_date, "2026-10-08");
refute(
  "…not the Friday, which is the answer with the set dropped",
  isRefusal(holiday) ? null : holiday.rows[0].target_date,
  "2026-10-09",
);

// ---------------------------------------------------------------------------
// 9. THE OUTPUT IS ZIPPED BY POSITION, NOT KEYED BY row_uid
//
// `unique (amendment_id, row_uid)` makes a duplicate impossible in the table,
// but the ladder is resolved on a form the operator is still typing into, where
// a copied row is ordinary. Keyed by uid, the second row silently takes the
// first one's date — an activity that reads as scheduled and is not.
// ---------------------------------------------------------------------------

const dup = orderTaLadder({
  rows: [row("dup", "Packing", 2), row("dup", "Final Inspection", 1)],
  quantities: QTY_10,
  deliveryDate: null,
  now: "2026-09-01",
});

check("two rows sharing a uid still get their own dates", dates(dup), ["2026-10-07", "2026-10-09"]);
refute("…they do not collapse onto one", dates(dup), ["2026-10-09", "2026-10-09"]);

console.log(failed === 0 ? "\nOK — every T&A ladder vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
