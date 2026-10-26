/**
 * Messages ▸ My Approvals (doc/slack.md/slack §7, comms phase 5).
 *
 * THIS IS THE EXISTING INBOX, NOT A COPY OF IT. The spec's rules — the ERP
 * workflow stays the authority, no second approval engine, every decision
 * re-checked on the server, a required reason, stale and concurrent decisions
 * refused — are already what `/approvals` does: `approval_my_queue` lists only
 * runs the caller may approve, `ApprovalActionBar` calls `actOnRun`, and
 * `approval_act` locks the run, compares `lock_version` and re-asks
 * `approval_can_act` in the same transaction. Rebuilding any of that here would
 * be the parallel engine the spec forbids, so the hub renders the same page.
 *
 * A decision revalidates this route as well (lib/approvals/actions.ts
 * `revalidateApprovals`), so the list refreshes from the workflow's own state.
 */
export { default } from "../../approvals/page";
