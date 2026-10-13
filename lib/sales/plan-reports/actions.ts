"use server";

import { can } from "@/lib/auth/server";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { accessoriesPlanReport, fabricPlanReport } from "./service";
import type { PlanKind, PlanReport } from "./types";

/**
 * ONE PLAN FOR REVIEW — Sample ▸ Plan Approval's sheet: the plan's report (the
 * document the approver signs) and its approval panel (run, whether this user
 * may act, timeline). One round trip: the two reads are independent.
 */
export async function loadPlanReview(kind: PlanKind, bomId: string) {
  if (!(await can("sales", "view"))) return { report: null, run: null, verdict: null, timeline: [], names: {} };
  const table = kind === "fabric" ? WORKFLOWS.sample_fabric_plan.subjectTable : WORKFLOWS.sample_accessories_plan.subjectTable;
  const [report, panel] = await Promise.all([
    kind === "fabric"
      ? fabricPlanReport(bomId).then((r): PlanReport | null => (r ? { kind: "fabric", report: r } : null))
      : accessoriesPlanReport(bomId).then((r): PlanReport | null => (r ? { kind: "accessories", report: r } : null)),
    getApprovalPanel(table, bomId),
  ]);
  return { report, ...panel };
}
