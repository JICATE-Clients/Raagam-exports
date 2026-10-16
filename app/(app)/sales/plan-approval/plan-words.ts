import type { QuickWord } from "@/components/orders/bom-queue";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";

/**
 * THE APPROVER'S WORDS FOR A PLAN'S STATE — Order Budget Approval's own
 * (client 2026-10-03: Pending · Approved · Rework Requested · Draft), so the
 * two approval screens say the same thing about the same state. This screen
 * only: the plan editors keep "With approver" / "Sent back", the planner's
 * view of the same states.
 *
 * STATED AS A MAP, as on the order screen: a fifth state is a type error here
 * rather than a row that silently belongs to no word.
 */
/* FOUR WORDS SINCE 2026-10-15 (user: Pending · Under Progress · Approved ·
   Draft across Orders and Sample). Rework Requested is back with the planner
   being re-worked — Under Progress, no longer "decided" beside Approved.
   The Plan Revision list reads this same map. */
const WORD: Record<PlanApprovalRow["status"], QuickWord> = {
  submitted: "pending",
  approved: "approved",
  returned: "progress",
  open: "draft",
};
export const planWord = (r: PlanApprovalRow): QuickWord => WORD[r.status];

export function planStatusText(r: Pick<PlanApprovalRow, "status" | "revisionNo">): string {
  switch (r.status) {
    case "submitted":
      return "Pending";
    case "approved":
      return "Approved";
    case "returned":
      return "Rework Requested";
    default:
      // A plan reopened by a revision is not a draft the planner never sent.
      return r.revisionNo > 0 ? `Revision ${r.revisionNo} open` : "Draft";
  }
}

export function planStatusTone(r: Pick<PlanApprovalRow, "status" | "revisionNo">): "success" | "info" | "warning" | "neutral" {
  if (r.status === "approved") return "success";
  if (r.status === "submitted") return "info";
  if (r.status === "returned" || r.revisionNo > 0) return "warning";
  return "neutral";
}
