import type { StatusTone } from "@/components/ui/status-pill";

// ============================================================================
// Orders ▸ TA ▸ TA Followups (0272). Actuals/progress against each planned
// activity of a TA Plan (ta_plan_activities). Status enum is provisional —
// legacy may carry Delayed / Hold; overdue is derived from dates. See
// doc/masters-open-questions.md.
// ============================================================================

export const TA_FOLLOWUP_STATUSES = ["pending", "in_progress", "done"] as const;
export type TaFollowupStatus = (typeof TA_FOLLOWUP_STATUSES)[number];

export const TA_FOLLOWUP_STATUS_LABELS: Record<TaFollowupStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Completed",
};

/** One flattened followup row (a TA-plan activity + its order/style context). */
export interface TaFollowupRow {
  id: string; // ta_plan_activities.id
  sno: number;
  order_no: string | null;
  delivery_date: string | null;
  proposed_delivery_date: string | null;
  order_qty: number | null;
  customer: string | null;
  style_code: string | null;
  sq_no: string | null;
  activity_name: string | null;
  department: string | null;
  details: string | null;
  plan_date: string | null; // planned finish (end_date)
  actual_date: string | null;
  status: TaFollowupStatus;
  description: string | null;
  notes: string | null;
}

/**
 * Followup traffic-light tone: done → success; actual recorded → success;
 * planned date overdue → danger; due within 7 days → warning; else info.
 */
export function taFollowupTone(
  row: Pick<TaFollowupRow, "plan_date" | "actual_date" | "status">,
  now: Date = new Date(),
): StatusTone {
  if (row.status === "done" || row.actual_date) return "success";
  if (!row.plan_date) return "neutral";
  const planned = new Date(row.plan_date + "T00:00:00");
  const days = Math.floor((planned.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  return "info";
}

/**
 * Days variance. If an actual date exists → actual − plan (negative = early).
 * Else if planned and still open and past → today − plan (positive = overdue).
 * Returns null when there is nothing to compare.
 */
export function followupDays(
  planDate: string | null,
  actualDate: string | null,
  status: TaFollowupStatus,
  now: Date = new Date(),
): number | null {
  if (!planDate) return null;
  const plan = new Date(planDate + "T00:00:00").getTime();
  if (actualDate) {
    const actual = new Date(actualDate + "T00:00:00").getTime();
    return Math.round((actual - plan) / 86_400_000);
  }
  if (status !== "done") {
    const days = Math.floor((now.getTime() - plan) / 86_400_000);
    return days > 0 ? days : null;
  }
  return null;
}
