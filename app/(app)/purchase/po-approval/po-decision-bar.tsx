"use client";

import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { approvePo, declinePo, rejectPo } from "@/lib/purchase/po-actions";
import type { ApprovalRun, CanActVerdict } from "@/lib/approvals/types";

/**
 * A PO'S DECISIONS, IN THE APPROVAL FORMAT — Request Rework · Reject · Approve, the bar
 * Orders ▸ Approval puts in its header (user 2026-11-04). ONE configuration for every
 * place a pending PO is decided from its overview — PO Approval's full page and the PO's
 * own page — so the two can never word or gate a decision differently.
 *
 *   Approve        → `approvePo` (signature, TBA, reopened-budget gates; ends the run).
 *                    One click, over budget too — no reason asked (user 2026-11-06).
 *   Request Rework → `rejectPo` — back to draft with the remark, and the PO's audit row.
 *   Reject         → `declinePo` — closed for good, its requirement back on Raise PO.
 *
 * Renders nothing unless the run's verdict says this user may act.
 */
export function PoDecisionBar({
  run,
  verdict,
  poId,
  subjectPath,
  onDone,
}: {
  run: ApprovalRun;
  verdict: CanActVerdict;
  poId: string;
  /** The page to revalidate with the decision. */
  subjectPath: string;
  onDone?: () => void;
}) {
  return (
    <ApprovalActionBar
      run={run}
      verdict={verdict}
      subjectPath={subjectPath}
      onDone={onDone}
      rework
      compact
      overrideNote={false}
      onApprove={(note) => approvePo(poId, note)}
      onRework={(reason) => rejectPo(poId, reason)}
      onRejectForGood={(reason) => declinePo(poId, reason)}
    />
  );
}
