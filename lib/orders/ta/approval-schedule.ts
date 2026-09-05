/**
 * The generic approval date calculator — every ta_approvals row EXCEPT PP
 * Sample, which is computed by the production backward-walk instead (see
 * lib/orders/ta/order-ladder.ts and this file's own header note on why).
 *
 * Two directions, chosen by ta_approvals.apply_condition:
 *   AFTER_ORDER_DATE    → target = order_date + lead_time_days, rolled
 *                          FORWARD over Sundays/holidays (never understate
 *                          the buyer's real turnaround).
 *   BEFORE_SHIPMENT_DATE → target = ex_factory_date - lead_time_days, rolled
 *                          BACKWARD over Sundays/holidays (preserve the
 *                          safety buffer rather than eating into it).
 *
 * NEVER REFUSES. Unlike the production engine (which cannot let a physical
 * step happen before the one it depends on), an administrative approval
 * buffer landing after the ship date is a NEGOTIATION problem, not a
 * scheduling impossibility — so this reports the conflict and lets the
 * order save. See AGENTS.md's own "never clamp, always show" rule; this is
 * the same rule applied to a business buffer instead of a physical one.
 */

import { addDays, dayOfWeek, isCalendarDate } from "@/lib/calendar";

export type ApprovalDirection = "AFTER_ORDER_DATE" | "BEFORE_SHIPMENT_DATE";

export type ApprovalScheduleInput = {
  approvalId: string;
  label: string;
  direction: ApprovalDirection;
  leadTimeDays: number;
};

export type ApprovalTargetSchedule = {
  approvalId: string;
  targetDate: string; // YYYY-MM-DD
  /** True when the target falls outside [order_date, ex_factory_date]. */
  isConflicted: boolean;
  /** ex_factory_date minus target_date, in calendar days. Negative = past the ship date. */
  slackDays: number;
  errorMessage: string | null;
};

/** Sunday only — same rule the production engine uses. Roll FORWARD to the next working day. */
function rollForward(iso: string, holidays: ReadonlySet<string>): string {
  let d = iso;
  while (dayOfWeek(d) === 0 || holidays.has(d)) d = addDays(d, 1);
  return d;
}

/** Roll BACKWARD to the previous working day. */
function rollBackward(iso: string, holidays: ReadonlySet<string>): string {
  let d = iso;
  while (dayOfWeek(d) === 0 || holidays.has(d)) d = addDays(d, -1);
  return d;
}

export function computeApprovalSchedule(input: {
  approvals: readonly ApprovalScheduleInput[];
  orderDate: string;
  exFactoryDate: string | null;
  holidays?: ReadonlySet<string>;
}): ApprovalTargetSchedule[] {
  const holidays = input.holidays ?? new Set<string>();

  return input.approvals.map((a): ApprovalTargetSchedule => {
    let raw: string;
    if (a.direction === "AFTER_ORDER_DATE") {
      raw = rollForward(addDays(input.orderDate, a.leadTimeDays), holidays);
    } else {
      if (!input.exFactoryDate || !isCalendarDate(input.exFactoryDate)) {
        // No ex-factory date yet — same "cannot say" state the production
        // ladder reports as a refusal, but this engine never refuses, so it
        // reports a conflict instead with no usable date.
        return {
          approvalId: a.approvalId,
          targetDate: input.orderDate,
          isConflicted: true,
          slackDays: 0,
          errorMessage: `${a.label}: enter the Earlier Shipment Date before scheduling`,
        };
      }
      raw = rollBackward(addDays(input.exFactoryDate, -a.leadTimeDays), holidays);
    }

    const slackDays = input.exFactoryDate
      ? Math.round(
          (Date.parse(input.exFactoryDate) - Date.parse(raw)) / 86_400_000,
        )
      : 0;
    const beforeOrder = raw < input.orderDate;
    const afterShip = input.exFactoryDate ? raw > input.exFactoryDate : false;
    const isConflicted = beforeOrder || afterShip;

    return {
      approvalId: a.approvalId,
      targetDate: raw,
      isConflicted,
      slackDays,
      errorMessage: isConflicted
        ? afterShip
          ? `${a.label}: target date falls ${Math.abs(slackDays)} day${Math.abs(slackDays) === 1 ? "" : "s"} past the ship date`
          : `${a.label}: target date falls before the order date`
        : null,
    };
  });
}
