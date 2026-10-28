import "server-only";
import { createClient } from "@/lib/supabase/server";
import { WORKFLOWS } from "./workflows";
import { poApproveRefusal } from "@/lib/purchase/po-approval-gate";

/**
 * A DOCUMENT'S OWN "NOT YET" BEFORE AN APPROVE LANDS (0764).
 *
 * The engine decides who may approve; it cannot know that the document itself has
 * moved since it was sent. Most workflows have no such check and return null here
 * at the cost of one read. A Purchase Order does — `poApproveRefusal` — and before
 * 0764 that check lived only behind the PO page's own Approve button, so routing the
 * PO into My Approvals would have opened a door around it.
 *
 * Only APPROVE is asked: a return or a reject sends the document back, which is
 * never what a stale state forbids.
 */
export async function preApproveRefusal(runId: string): Promise<string | null> {
  const s = await createClient();
  const { data } = await s.from("approval_runs").select("workflow_key, subject_id").eq("id", runId).maybeSingle();
  const run = data as { workflow_key: string; subject_id: string } | null;
  if (!run) return null;
  if (run.workflow_key === WORKFLOWS.purchase_order.key) return poApproveRefusal(run.subject_id);
  return null;
}
