import type { PoApprovalCard } from "./po-approval-cards";

/**
 * A PO's budget state, read off its card — ONE rule for every screen that asks (PO
 * Approval's Within / Over switch, the PO page's approval view, and whether Approve needs
 * a reason). Its own file, not in `po-approval-cards.ts`, because that one is server-only
 * and the PO Approval screen is a client component.
 *
 * `over` also covers a reader who may not see figures (a Purchase Manager): the save
 * refuses an above-budget send without a reason, so a reason on the PO means it was sent
 * above budget. `unknown` = no figures and no reason.
 */
export type PoBudgetState = "over" | "within" | "none" | "unknown";

export function poBudgetState(c: PoApprovalCard | undefined | null): PoBudgetState {
  if (!c) return "unknown";
  if (c.overCount == null) return c.reason ? "over" : "unknown";
  if (c.overCount > 0) return "over";
  return c.unbudgetedCount && c.unbudgetedCount >= c.lineCount ? "none" : "within";
}
