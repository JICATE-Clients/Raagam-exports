/**
 * T&A LADDER ▸ the shapes the tab's read-only views share, and the two
 * derivations all three of them read.
 *
 * Filed beside `order-ladder.ts` rather than in a new top-level `types/` folder,
 * because this app keeps its vocabulary in `lib/<module>/` and the T&A domain
 * already lives here (`order-ladder.ts` builds the dates, `approval-schedule.ts`
 * the approvals). A second home for the same subject is how two spellings of one
 * status get born.
 *
 * ## THIS FILE HOLDS FUNCTIONS AS WELL AS TYPES, ON PURPOSE
 *
 * "Is this milestone late?" is asked by the badge, by the grid and by the
 * summary counts, and if each answered for itself the card could read
 * `Delayed 3` above a table showing four red rows. Same shape
 * `missingRequiredMaterialFields` takes in `material-types.ts` (AGENTS.md,
 * "Mandatory fields"): one exported function, every consumer calls it.
 *
 * Pure and client-safe — no `.tsx`, no server imports — so the tab, a server
 * page and a check script can all read it.
 */

import { daysBetween } from "@/lib/calendar";

/**
 * THE STORED STATUS, AND IT IS THE DATABASE'S LIST RATHER THAN A NEW ONE.
 *
 * `garment_order_amendment_ta_activities.status` is `text not null default
 * 'pending'` under a CHECK constraint naming exactly these three
 * (0481_order_amendment_ta_activities.sql:340-352). **`done`, not `completed`** —
 * the word "Completed" belongs on the label the operator reads, never in the
 * value, and a badge keyed on `"completed"` would fall through to its default
 * for every row the database has ever written.
 *
 * There is no `delayed` here for the same reason: lateness is not a state anyone
 * sets, it is `target_date` against today. See `TnaDisplayState`.
 */
export type TnaStatus = "pending" | "in_progress" | "done";

/** The three, in ladder order, for a filter facet or a legend. */
export const TNA_STATUSES: readonly TnaStatus[] = ["pending", "in_progress", "done"] as const;

/**
 * WHAT A BADGE SHOWS — the stored status, plus the one state that is computed.
 *
 * `delayed` is derived and never stored. The index 0481 adds for the daily
 * dashboard states the same rule in SQL (`where target_date <= $today and status
 * <> 'done'`), and `lib/ta/worklist.ts` states it again in TypeScript for the
 * merchandiser board — this is the third reader of one rule, so it calls
 * `tnaDisplayState` rather than re-testing the dates.
 */
export type TnaDisplayState = TnaStatus | "delayed";

/**
 * One rung of the order's Time & Action ladder, AS A READ-ONLY VIEW HOLDS IT.
 *
 * Deliberately not `TaRow` (`garment-order-screen.tsx`) and not `TaRowCore`
 * (`lib/orders/amendments/types.ts`). Those are the EDITOR's shapes: they carry
 * what the operator types and leave out everything derived, because copying a
 * derived value onto a typed row is a second answer that goes stale. This one is
 * the opposite — it is what a viewer needs already resolved, which is why
 * `targetDate` and `departmentName` are present here and absent there.
 */
export interface TnaMilestone {
  /**
   * The data's identity, NOT React's. `row_uid` is minted once and round-trips
   * every save; `id` is re-minted by `writeChildren` on each write, so anything
   * keyed on it is lost the first time the order is saved. `TaRow`'s own note
   * records what that costs.
   */
  rowUid: string;
  /** `ta_activities.id`. Null on a row the operator added by hand. */
  activityId: string | null;
  /** The activity's name — "Knitting", "Fabric Plan". */
  activity: string;
  /** Resolved through `activity_id`, never stored on the row. */
  departmentName: string | null;
  /** Who has claimed this rung (0547). Null = the whole department's. */
  assignedStaffName: string | null;
  /** The operator's "Days" offset. Null is a rung nobody has filled in. */
  daysRequired: number | null;
  /**
   * `YYYY-MM-DD`, out of `orderTaLadder()`. **Null is a real answer** and the
   * convention that file, `schedule.ts` and `requirement.ts` all record: the
   * walk stops at a rung with no Days, and every rung further from delivery
   * gets null rather than a guessed date. A plan is read as a promise.
   */
  targetDate: string | null;
  /** When it actually happened. Entered on the dashboard, days or weeks later. */
  actualDate: string | null;
  status: TnaStatus;
  notes: string | null;
}

/** The four counts above the grid. See `tnaSummary` for what each one means. */
export interface TnaSummaryStats {
  total: number;
  completed: number;
  delayed: number;
  upcoming: number;
}

/**
 * COMPLETE MEANS EITHER HALF — `actual_date` filled in, OR `status = 'done'`.
 *
 * Both are real: the merchandiser board sets the status, and a date entered
 * against a rung is a completion whether or not anyone remembered to move the
 * dropdown. `lib/ta/worklist.ts` drops a row from the worklist on exactly this
 * test, so a rung counted complete here is a rung that has left the board.
 */
export function isTnaComplete(m: TnaMilestone): boolean {
  return m.actualDate != null || m.status === "done";
}

/**
 * The one answer to "what does this rung look like today".
 *
 * `todayIso` is PASSED IN rather than read here, so every rung on a screen is
 * judged against the same date — a summary that called `today()` for itself
 * could disagree with the grid beneath it across a midnight render, and the two
 * would be one day apart with nothing on screen to say why.
 *
 * CALENDAR DAYS, NOT WORKING DAYS, and `worklist.ts` records why in full: a
 * working-day margin hands every slip that crosses a weekend an extra day of
 * grace, which is grace in the one direction that costs money. Working days
 * BUILD the ladder (`lib/ta/schedule.ts`); calendar days judge it.
 *
 * An undated rung is never delayed — there is no promise to have missed.
 */
export function tnaDisplayState(m: TnaMilestone, todayIso: string): TnaDisplayState {
  if (isTnaComplete(m)) return "done";
  if (m.targetDate && daysBetween(m.targetDate, todayIso) > 0) return "delayed";
  return m.status;
}

/**
 * How many days late, or null when the rung is not late. Positive only —
 * the same sign convention `WorklistRow.daysLate` uses, so "3" means the same
 * thing on this tab and on the merchandiser board.
 */
export function tnaDaysLate(m: TnaMilestone, todayIso: string): number | null {
  if (tnaDisplayState(m, todayIso) !== "delayed" || !m.targetDate) return null;
  return daysBetween(m.targetDate, todayIso);
}

/**
 * The four counts, derived from the rows the grid is showing — never fetched
 * separately. A card that counted server-side while the table filtered
 * client-side is a KPI that disagrees with the list under it.
 *
 * **THE FOUR ARE EXHAUSTIVE**: every rung is complete, late, or neither, so
 * `completed + delayed + upcoming === total` always. That is worth keeping —
 * a reader can check the card against itself.
 *
 * `upcoming` therefore means "open and not yet past due", which folds in the
 * rung due TODAY (still open, not yet missed) and the rung with no target date
 * at all (nothing to miss). `worklist.ts` splits those into `today` / `upcoming`
 * because a merchandiser works that list hour by hour; four cards above a ladder
 * are a shape, not a queue, and a fifth count nobody asked for would be the
 * first thing to go stale.
 */
export function tnaSummary(rows: readonly TnaMilestone[], todayIso: string): TnaSummaryStats {
  let completed = 0;
  let delayed = 0;
  for (const r of rows) {
    const state = tnaDisplayState(r, todayIso);
    if (state === "done") completed++;
    else if (state === "delayed") delayed++;
  }
  return {
    total: rows.length,
    completed,
    delayed,
    upcoming: rows.length - completed - delayed,
  };
}
