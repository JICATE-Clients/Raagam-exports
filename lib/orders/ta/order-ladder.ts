/**
 * The order's Time & Action ladder — one function the T&A tab and the server
 * action both call, so the dates on screen and the dates in the database are
 * the same dates.
 *
 * `garment_order_amendment_ta_activities.target_date` is STORED, which is the
 * exception in this repo rather than the rule (`stage_no` in
 * `process-chain/chain.ts` is the canonical statement of "derive, never store").
 * It is stored for one reason: the daily dashboard asks Postgres "what is due
 * today, across every open order", and a working-day ladder with a holiday set
 * is not a question SQL can answer. What makes storing it safe is the rule
 * `purchase_qty` already follows — BOTH HALVES OR NEITHER: the Save button and
 * the server action resolve the ladder through THIS function, so the stored date
 * is never a second opinion. A screen resolving a ladder the server did not is a
 * date no control enforces.
 *
 * Client-safe on purpose, the `bom-ceiling.ts` split this repo already uses.
 *
 * ## WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Nearly all of it. This file is the ORDER's half — which date the ladder hangs
 * off, and which way round the list runs — and nothing else. Re-deriving any of
 * the below would produce a second answer to a question that already has one:
 *
 *   - **Date arithmetic.** `lib/calendar.ts` owns it, in `YYYY-MM-DD` strings,
 *     because `new Date("2026-08-23")` is UTC midnight and reads as the 22nd on
 *     a UTC+5:30 business. Two local copies of `addDays` were already deleted
 *     from `ta-plan-screen.tsx` for dating plans a day early. Nothing here
 *     constructs a `Date`.
 *   - **Working days, Sundays, holidays and the backward walk.**
 *     `lib/ta/schedule.ts` → `backwardSchedule`, already vectored by
 *     `npm run check:ta-schedule`. This wraps it; it does not reimplement it.
 *   - **Seeding the rows.** Which activities an order starts with, and in what
 *     order, is the screen's question — read out of `ta_activities` by
 *     `sequence`. This takes the rows it is given, in the order it is given
 *     them, and never sorts them: a ladder is the operator's sequence, and a
 *     module that quietly re-sorted it would move dates nobody edited.
 *   - **Persistence.** No `id`, no reads, no writes.
 *
 * ## THE ORDER REVERSAL LIVES HERE AND NOWHERE ELSE
 *
 * `backwardSchedule` takes its steps DOWNSTREAM-FIRST (the task nearest
 * shipment first) because that is the order the arithmetic runs in, and its own
 * header says why it will not accept them the other way round: *"a list that has
 * to be reversed before use is a list that will be reversed twice by someone."*
 *
 * The grid renders EXECUTION order — Fabric Plan, Accessories BOM, Yarn
 * Purchase, Knitting, Dyeing, Cutting, Sewing, Packing, Inspection, Shipment.
 * So this function reverses on the way in and reverses back on the way out, and
 * **no caller ever reverses**. A screen that reversed as well would schedule the
 * ladder inside out and every date would still look like a date.
 *
 * The two halves are aligned BY POSITION, not by `row_uid`: the reversed output
 * zips back onto the input array index for index. Keying by `row_uid` would be
 * correct only while it is unique, and `unique (amendment_id, row_uid)` is a
 * guarantee about the TABLE, not about a form the operator is still typing into
 * — a copied row is ordinary there, and a row that silently took its twin's date
 * is a missing activity that reads as a shorter plan.
 *
 * ## SO ROW ORDER IS PART OF THE CONTRACT, AND BOTH CALLERS OWE IT
 *
 * The consequence of zipping by position: `rows` must arrive in the SAME order
 * from the screen and from the server action — `ta_activities` by `sequence`,
 * which is what the grid renders. Hand them over in a different order and every
 * date attaches to the wrong activity. There is no refusal for it and there
 * cannot be one: the ladder is arithmetic over a list, so a permuted list is a
 * perfectly well-formed list, every date it produces is a real date, and the two
 * halves of the "both halves or neither" rule that makes `target_date` safe to
 * store would disagree about which row each date belongs to while both looked
 * entirely ordinary.
 *
 * This is not sorted for the caller on purpose. A ladder is the operator's
 * sequence; a module that quietly re-sorted it would move dates nobody edited,
 * and it would hide the disagreement rather than making the callers own it.
 *
 * ## NULL IS AN ANSWER. A GUESSED DATE IS NOT.
 *
 * The convention `requirement.ts`, `chain.ts` and `schedule.ts` all record, and
 * it matters more here than anywhere: a wrong date is a delivery that misses,
 * and a plan is read as a promise. A branch that genuinely cannot answer
 * ANYTHING (no anchor, no rows at all) still returns a `Refusal` carrying the
 * sentence the screen prints — never `0`, never a silent skip.
 *
 * `days_required: null` is a row nobody filled in, and it no longer refuses
 * the WHOLE ladder (client, 2026-09-07 — see `Schedule`'s header in
 * `lib/ta/schedule.ts` for the full reasoning). It stops the walk AT that row:
 * every row nearer delivery keeps the `target_date` it already earned, and
 * that row plus every row further from delivery gets `target_date: null`.
 * `TaLadderResult.incomplete` carries the same sentence a total refusal used
 * to name the row with (*"Knitting: enter how many days it needs"*), passed
 * through unchanged rather than restated — two sentences for one fact is how
 * they drift apart.
 */

import { daysBetween, isCalendarDate, today } from "@/lib/calendar";
import {
  addWorkingDays,
  backwardSchedule,
  isRefusal,
  subtractWorkingDays,
  type Refusal,
} from "@/lib/ta/schedule";

export type { Refusal };
export { isRefusal };

/** One row of the T&A grid, as much of it as the ladder needs. */
export type TaLadderRow = {
  /**
   * The 0446/0459 anchor — minted client-side and round-tripped by the form.
   * Never `id`, which `writeChildren` re-mints on every save, and which is what
   * an `actual_date` entered on the dashboard weeks later would be lost to.
   */
  row_uid: string;
  activity_id: string | null;
  /** The activity's name. Carried so a refusal can NAME the row it is about. */
  label: string;
  /** The operator's "Days" offset. NULL is an unfilled row and REFUSES. */
  days_required: number | null;
  /**
   * SIDE ACTIVITY (0561, client 2026-09-15) — Sewing Trims Inward hangs off
   * Cutting, Packing Trims Inward off Packing. Such a row is dated
   * `days_required` working days before its anchor's START and is a single
   * arrival date (start = end). It NEVER enters the backward chain, so its lead
   * time cannot push Cutting, PP Approval or Materials In-House back — trims
   * feed the critical path, they are not on it. Absent / null = an ordinary
   * chain step. Read from `ta_activities.anchor_activity_id` by both callers.
   */
  anchor_activity_id?: string | null;
};

/**
 * The last day of a task that STARTS on `start` and needs `days` working days:
 * `start + (days − 1)` working days, so a 1-day task starts and ends the same
 * day and a 2-day Packing from Thu Oct 1 ends Fri Oct 2.
 *
 * It used to be `start + days`, which is the NEXT task's start — every task
 * overlapped its successor by a day and a 2-day task printed as three (client
 * spec 2026-09-15, "Lead Time Date Span Bug"). Exported because the T&A
 * worklist shows the same End date from the stored start, and one rule
 * written twice is how the two drift apart.
 */
export function taSpanEnd(
  start: string,
  days: number | null,
  holidays?: ReadonlySet<string>,
): string | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= 1) return start;
  const e = addWorkingDays(start, days - 1, holidays);
  return isRefusal(e) ? null : e;
}
/** Where the ladder hangs off, and which field that date came from. */
export type TaLadderAnchor = {
  date: string;
  /**
   * Stated on screen. A ladder shown without saying what it hangs off is a
   * ladder the operator cannot check — the dates are all derived, so the anchor
   * is the only figure they can compare against the buyer's paperwork.
   */
  source: "earlier_shipment" | "delivery";
};

export type TaLadderResult = {
  /**
   * EXECUTION order — Fabric Plan first, Shipment last. What the grid
   * renders. `target_date`/`float` are `null` on a row whose OWN Days is
   * blank, or whose neighbour nearer delivery hasn't answered its Days yet —
   * see `Schedule.incomplete` in `lib/ta/schedule.ts` for why that is a
   * partial result, not a refusal.
   *
   * `end_date` (client request, 2026-09-11: "only showing the start date of
   * the activity, need to show the end date") is the task's LAST working day,
   * `taSpanEnd` — inclusive, so the span `[target_date, end_date]` holds
   * exactly `days_required` working days and ends the working day BEFORE the
   * next row starts. (It was the next row's start until 2026-09-15.) A side
   * activity's is its own `target_date`: an arrival is one day. `null` under
   * the exact same conditions `target_date` is.
   */
  rows: (TaLadderRow & { target_date: string | null; float: number | null; end_date: string | null })[];
  anchor: TaLadderAnchor;
  /** Work must begin here — `null` while `incomplete` is set. */
  startDate: string | null;
  /**
   * Calendar days from `now` to `startDate`, or `null` alongside it.
   * NEGATIVE IS REPORTED, NEVER CLAMPED — `backwardSchedule`'s rule, and this
   * is the surface it reaches: a start date pulled forward to today is a plan
   * claiming to be achievable when the order cannot be made on time.
   */
  float: number | null;
  /** The first row (nearest delivery) with no Days yet, passed straight
   *  through from `Schedule.incomplete` — present exactly when `startDate`
   *  is `null`. */
  incomplete?: { label: string; reason: string };
};

/**
 * The anchor: the EARLIEST non-blank `earlier_shipment_date` across the
 * Quantities rows, falling back to the header `delivery_date`.
 *
 * The Quantities grid is per country/consignee, so there are N of these dates
 * and they legitimately differ. The whole order has to be ready for the FIRST
 * lorry, so the earliest is the constraint — taking the header's date while an
 * earlier consignment sits in the grid would schedule the floor to be late for a
 * shipment nobody moved.
 *
 * Malformed dates REFUSE rather than being skipped, and that is what makes the
 * earliest-of-N correct: `min` over `YYYY-MM-DD` strings is a chronological
 * comparison only while every candidate really is one. A `date` column and an
 * `<input type="date">` both hand over ISO or nothing, so this branch is a guard
 * against a caller, not against an operator — but a guard that silently dropped
 * the bad value would pick the wrong anchor and date the entire ladder off it.
 *
 * **THE SHAPE AND THE CALENDAR ARE TWO DIFFERENT QUESTIONS**, and this guard was
 * half-built until it asked the second one. It began as a local
 * `/^\d{4}-\d{2}-\d{2}$/`, which catches `10/10/2026` — the wrong shape, the easy
 * half — and waves `2026-02-31` straight through, because that string is
 * perfectly shaped and simply is not a day. `Date.UTC` then rolls it to March 3
 * without erroring, so the ladder hung off a date that does not exist and its
 * derived dates straddled it: Feb 27 and Mar 2 either side of an anchor printed
 * as Feb 31. `isCalendarDate` (`lib/calendar.ts`) asks both, by round-tripping
 * the value through the same arithmetic that will consume it.
 */
function resolveAnchor(
  quantities: readonly { earlier_shipment_date: string | null }[],
  deliveryDate: string | null,
): TaLadderAnchor | Refusal {
  let earliest: string | null = null;
  for (const q of quantities) {
    const at = (q.earlier_shipment_date ?? "").trim();
    if (!at) continue;
    if (!isCalendarDate(at)) return { refused: `"${at}" is not a date` };
    if (earliest === null || at < earliest) earliest = at;
  }
  if (earliest !== null) return { date: earliest, source: "earlier_shipment" };

  const delivery = (deliveryDate ?? "").trim();
  if (!delivery) {
    return {
      refused: "Enter the Earlier Shipment Date on the Quantities tab before scheduling",
    };
  }
  if (!isCalendarDate(delivery)) return { refused: `"${delivery}" is not a date` };
  return { date: delivery, source: "delivery" };
}

/**
 * Date the whole ladder, backwards from the order's anchor.
 *
 * @param rows in EXECUTION order, exactly as the grid holds them.
 */
export function orderTaLadder(input: {
  rows: readonly TaLadderRow[];
  quantities: readonly { earlier_shipment_date: string | null }[];
  deliveryDate: string | null;
  holidays?: ReadonlySet<string>;
  /** Overridable so the vectors do not depend on the day they run. */
  now?: string;
}): TaLadderResult | Refusal {
  // The anchor is tested FIRST, ahead of an empty ladder: an order with no
  // shipment date has nothing to schedule against however many activities it
  // carries, and that is the sentence worth printing.
  const anchor = resolveAnchor(input.quantities, input.deliveryDate);
  if (isRefusal(anchor)) return anchor;

  // IN: execution order reversed is downstream-first, which is what
  // `backwardSchedule` takes. See the header — this and the reverse below are
  // the only two reversals in the feature.
  // SIDE ROWS STAY OUT OF THE CHAIN (0561) — see `TaLadderRow.anchor_activity_id`.
  const isSide = (r: TaLadderRow) => !!r.anchor_activity_id;
  const chain = input.rows.filter((r) => !isSide(r));

  const steps = [...chain]
    .reverse()
    .map((r) => ({ key: r.row_uid, label: r.label, days: r.days_required }));

  const plan = backwardSchedule({
    deliveryDate: anchor.date,
    steps,
    holidays: input.holidays,
    now: input.now,
  });
  if (isRefusal(plan)) return plan;

  // OUT: back to execution order, zipped onto the CHAIN rows BY POSITION.
  const scheduled = [...plan.steps].reverse();
  const chainDated = chain.map((r, i) => {
    const target_date = scheduled[i].date;
    return {
      ...r,
      target_date,
      float: scheduled[i].float,
      end_date: target_date == null ? null : taSpanEnd(target_date, r.days_required, input.holidays),
    };
  });

  // Chain rows go back into their own slots in input order; each side row is
  // dated off the START of the first chain row carrying its anchor activity.
  // No anchor on this ladder, no start on the anchor yet, or no Days of its
  // own — the side row is undated and the chain is untouched either way.
  const now = input.now ?? today();
  let c = 0;
  const rows = input.rows.map((r) => {
    if (!isSide(r)) return chainDated[c++];
    const undated = { ...r, target_date: null, float: null, end_date: null };
    const from = chainDated.find((x) => x.activity_id === r.anchor_activity_id)?.target_date;
    const days = r.days_required;
    if (from == null || days == null || !Number.isFinite(days)) return undated;
    const at = subtractWorkingDays(from, days, input.holidays);
    if (isRefusal(at)) return undated;
    return { ...r, target_date: at, float: daysBetween(now, at), end_date: at };
  });

  // A trim due before the chain's first step is still work that must begin
  // then, so the start date is the earliest dated row — once the chain itself
  // is complete (`incomplete` keeps meaning what it meant).
  let startDate = plan.startDate;
  if (startDate != null) {
    for (const r of rows) if (r.target_date != null && r.target_date < startDate) startDate = r.target_date;
  }

  return {
    rows,
    anchor,
    startDate,
    float: startDate == null ? null : daysBetween(now, startDate),
    ...(plan.incomplete && { incomplete: plan.incomplete }),
  };
}
