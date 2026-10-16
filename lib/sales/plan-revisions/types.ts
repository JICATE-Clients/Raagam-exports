/**
 * Sample ▸ Revision — PLAN REVISIONS (Fabric Plan · Accessories Plan), the
 * shared, client-safe half. The loaders are ./service.ts, the writes
 * ./actions.ts, the database 0718 / 0720 / 0727 / 0730.
 *
 * A REVISION ENTRY is what one Raise Revision made: one revision per plan it
 * ticked, sharing `entry_id` (0730). The register lists one line per plan
 * revision, grouped by SWO; the workspace `/sales/sample-revision/plan/<entry>`
 * opens the entry — Overview, then a tab per plan it reopened.
 *
 * NO STATUS IS STORED ON A REVISION. It is read off the plan it reopened: the
 * revision the plan is IN (`plan.revision_no`) takes the plan's own approval
 * state; one the plan has moved past was approved (a raise needs an approved
 * plan); `abandoned_at` closes one for good. A third column would be one more
 * thing to disagree.
 */

import type { QuickWord } from "@/components/orders/bom-queue";
import type { PlanApprovalStatus, PlanKind } from "@/lib/sales/plan-reports/types";

export type PlanRevisionStatus = "editing" | "returned" | "submitted" | "approved" | "abandoned";

export function planRevisionStatusOf(
  rev: { revision_no: number; abandoned_at: string | null },
  plan: { status: PlanApprovalStatus; revisionNo: number },
): PlanRevisionStatus {
  if (rev.abandoned_at) return "abandoned";
  if (plan.revisionNo !== rev.revision_no) return "approved";
  switch (plan.status) {
    case "submitted":
      return "submitted";
    case "approved":
      return "approved";
    case "returned":
      return "returned";
    default:
      return "editing";
  }
}

export const PLAN_REVISION_STATUS_LABEL: Record<PlanRevisionStatus, string> = {
  editing: "Under revision",
  returned: "Rework Requested",
  submitted: "Pending",
  approved: "Approved",
  abandoned: "Abandoned",
};

export const planRevisionTone = (s: PlanRevisionStatus): "success" | "info" | "warning" | "neutral" =>
  s === "approved" ? "success" : s === "submitted" ? "info" : s === "editing" || s === "returned" ? "warning" : "neutral";

/**
 * THE BOX'S WORDS — Plan Approval's four (`planWord`), read for a revision.
 * Being edited and sent back are both work in progress; there is no Draft (a
 * revision is never a draft nobody sent — user decision), and an abandoned one
 * is in no word: it is reached through the drawer's Status facet.
 */
const WORD: Record<PlanRevisionStatus, QuickWord | null> = {
  submitted: "pending",
  editing: "progress",
  returned: "progress",
  approved: "approved",
  abandoned: null,
};
export const planRevisionWord = (s: PlanRevisionStatus): QuickWord | null => WORD[s];

/** Still the operator's to work — and so to abandon. Not while the approver holds it. */
export const planRevisionIsOpen = (s: PlanRevisionStatus) => s === "editing" || s === "returned";

/** Why a revision cannot be abandoned — the greyed icon's sentence; null = it can. */
export function abandonRefusal(statuses: readonly PlanRevisionStatus[]): string | null {
  if (statuses.some(planRevisionIsOpen)) return null;
  if (statuses.some((s) => s === "submitted")) return "With the approver — abandon once it is sent back";
  if (statuses.every((s) => s === "abandoned")) return "Already abandoned";
  return "Approved — nothing left to abandon";
}

/** One plan revision — a line of the register, a plan of the workspace. */
export type PlanRevisionRow = {
  /** The revision log row id. */
  id: string;
  /** The raise that made it (0730) — the workspace's id. */
  entryId: string;
  kind: PlanKind;
  bomId: string;
  iwoId: string;
  swoCode: string | null;
  iwoCode: string | null;
  season: string | null;
  smpNos: string[];
  revisionNo: number;
  reason: string;
  origin: string | null;
  raisedAt: string;
  status: PlanRevisionStatus;
  /** The plan as it stands now (Plan Approval's state + number). */
  planStatus: PlanApprovalStatus;
  planRevisionNo: number;
  abandonedAt: string | null;
  abandonReason: string | null;
  created_at: string;
  created_by: string | null;
};

/** The workspace's tabs: Overview, then one per plan kind (its route segment). */
export type PlanRevisionTab = "overview" | PlanKind;

export const planRevisionHref = (entryId: string, tab: PlanRevisionTab = "overview") =>
  tab === "overview" ? `/sales/sample-revision/plan/${entryId}` : `/sales/sample-revision/plan/${entryId}/${tab}`;

/**
 * THE STEP BAR — Raised → Editing → Submitted → Approved / Sent back, read off
 * the entry's plans. With two plans, the entry stands where the LEAST advanced
 * open one stands: it is not submitted until every plan it reopened is.
 */
export type PlanRevisionStep = "raised" | "editing" | "submitted" | "decided";
export function entryStepOf(statuses: readonly PlanRevisionStatus[]): {
  step: PlanRevisionStep;
  outcome: "approved" | "returned" | "abandoned" | null;
} {
  const live = statuses.filter((s) => s !== "abandoned");
  if (live.length === 0) return { step: "decided", outcome: "abandoned" };
  if (live.some((s) => s === "returned")) return { step: "decided", outcome: "returned" };
  if (live.some((s) => s === "editing")) return { step: "editing", outcome: null };
  if (live.some((s) => s === "submitted")) return { step: "submitted", outcome: null };
  return { step: "decided", outcome: "approved" };
}
