"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/server";
import { listFlows, saveFlow, setFlowActive } from "@/lib/approvals/service";
import { PO_WORKFLOW, planRouting, routingProblem, type PoRouting } from "./po-routing-model";

type Result = { ok: true } | { ok: false; error: string };

/**
 * SAVE PO APPROVAL ROUTING (user 2026-10-28) — the screen's whole state, written
 * as the purchase_order flows the engine routes by.
 *
 * The plan is rebuilt HERE from the flows as they are now, never trusted from the
 * browser, so two admins saving a minute apart cannot resurrect each other's
 * retired flow ids.
 *
 * ORDER MATTERS, because the writes are separate statements: the new and changed
 * flows go first, the retired ones are switched off last. A failure part-way
 * therefore leaves an EXTRA active flow — every PO still routes somewhere — never
 * a routing with a hole in it. Runs already started are untouched either way:
 * each carries its own frozen copy of its steps.
 */
export async function savePoRouting(routing: PoRouting): Promise<Result> {
  // Same gate as Approvals ▸ Flows: this changes who can approve.
  if (!(await can("approvals", "edit"))) return { ok: false, error: "Forbidden" };
  const problem = routingProblem(routing);
  if (problem) return { ok: false, error: problem };
  try {
    const plan = planRouting(routing, await listFlows(PO_WORKFLOW));
    for (const draft of plan.save) await saveFlow(draft);
    for (const id of plan.retire) await setFlowActive(id, false);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The routing could not be saved" };
  }
  revalidatePath("/purchase/po-approval-routing");
  revalidatePath("/approvals/flows");
  return { ok: true };
}
