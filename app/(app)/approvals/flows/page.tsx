import { requirePermission } from "@/lib/auth/server";
import { listFlows } from "@/lib/approvals/service";
import { listRoleOptions } from "@/lib/approvals/admin";
import { ifInstalled } from "@/lib/approvals/install";
import { ApprovalsNotInstalled } from "@/components/approvals/approvals-not-installed";
import { withCreators } from "@/lib/created-by";
import { ApprovalFlowsScreen, type FlowRow } from "./approval-flows-screen";

/**
 * APPROVAL FLOWS — who signs what, in what order, under which conditions.
 *
 * ## GATE 5, AND IT IS A HARD GATE
 *
 * The skill states it plainly: "the builder writes config that changes who can
 * approve. Confirm the route is gated on `approvals.flow.manage` before it is
 * reachable." `requirePermission` here is the first half; `approval_flows`'
 * own RLS write policy is the second and the real one — without that, a
 * PostgREST call would bypass this page entirely and the gate would be
 * decoration.
 *
 * Note this is `edit` and not `view`: reading the flows is not the risk, and an
 * approver legitimately reads them through the timeline's step labels. Building
 * one is the privileged act.
 */
export default async function ApprovalFlowsPage() {
  await requirePermission("approvals", "edit");

  /* THE ENGINE MAY NOT BE IN THIS DATABASE YET. The screens ship with a `git
     pull`; the tables ship when somebody applies 0500–0505, and in between this
     route used to 500 on `approval_flows` not being in the schema cache. Say so
     instead — see `lib/approvals/install.ts`. */
  const flows = await ifInstalled(() => listFlows());
  if (flows === null) return <ApprovalsNotInstalled />;

  const roles = await listRoleOptions();

  /* The Created pair, through the app's one helper — `approval_flows.created_by`
     defaults to `auth.uid()` (0501), so unlike the 143 services AGENTS.md
     records, this one has a value to resolve from the first row onward. */
  const rows: FlowRow[] = await withCreators(flows);

  return <ApprovalFlowsScreen rows={rows} roles={roles} />;
}
