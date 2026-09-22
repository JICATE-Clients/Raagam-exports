"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { budgetBaseline } from "@/lib/orders/budget/amendment";
import { budgetFiguresOf, getOrderBudget } from "@/lib/orders/budget/service";
import { orderAmendmentOf, orderLockOf } from "@/lib/orders/budget/lock";
import { raiseAmendmentInput, type RaiseAmendmentInput } from "./types";

type Result = { ok: true; id?: string; entryNo?: string; outcome?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

function rev() {
  revalidatePath("/orders/order-amendments");
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/garment-orders");
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/orders/material-bom");
  revalidatePath("/orders/budgets");
  revalidatePath("/approvals");
}

/**
 * RAISE AN AMENDMENT — the merchandiser's door (`open_order_amendment`, 0604 ·
 * 0616). One RPC, one transaction: the entry with its frozen money baseline,
 * frozen scope and V0 order snapshot; the RE moved to `amending`; the approved
 * budget sent back to draft for its fresh cycle.
 *
 * THE BASELINE IS COMPUTED HERE, by `budgetFiguresOf` — the same assembler the
 * budget screen and submit use — because the approved budget is locked and its
 * orders are locked, so the figures computed now ARE the approved figures. The
 * RPC refuses without one: an amendment with no baseline has nothing to show a
 * variance against.
 */
export async function raiseOrderAmendment(input: RaiseAmendmentInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to amend an order");
  const p = raiseAmendmentInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  let lock;
  let amending;
  try {
    lock = await orderLockOf(p.data.order_id);
    amending = lock ? null : await orderAmendmentOf(p.data.order_id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not read the order's lock");
  }
  if (!lock && !amending) return fail("This order is not approved, so it needs no amendment — edit it directly");
  if (lock && !lock.budgetId) return fail("This order is locked but its approved budget cannot be read — nothing was amended");

  /* ALREADY AMENDING (0618): the new entry SUPERSEDES the open one and the RPC
     copies its V0 baseline and snapshot — no figures are computed here, since
     the budget is a draft now and would not be the approved baseline. */
  let baseline: unknown = null;
  if (lock) {
    try {
      const budget = await getOrderBudget(lock.budgetId);
      if (!budget) return fail("The approved budget no longer exists");
      const figures = await budgetFiguresOf(budget);
      baseline = budgetBaseline({ kpis: figures.kpis, general: figures.general, lines: budget.lines });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "The approved figures could not be worked out");
    }
  }

  const s = await createClient();
  const { data, error } = await s.rpc("open_order_amendment", {
    p_order: p.data.order_id,
    p_source: p.data.origin,
    p_types: p.data.types,
    p_reason: p.data.remarks,
    p_baseline: baseline,
  });
  if (error) return fail(error.message);
  const row = ((data ?? []) as { entry_id: string; entry_no: string | null }[])[0];
  if (!row) return fail("The amendment was not recorded");

  await writeAudit({
    action: "order_amendment.raised",
    entityType: "order_budget_revision",
    entityId: row.entry_id,
  });
  rev();
  return { ok: true, id: row.entry_id, entryNo: row.entry_no ?? undefined };
}

/**
 * ABANDON an open entry (`abandon_order_amendment`, 0616). The RPC decides:
 * nothing changed → the V0 approval is restored and the RE re-locks
 * ('restored'); something changed → the entry closes and the RE stays open
 * with its budget in draft ('reopened'). Refused while the budget is with the
 * approver.
 */
export async function abandonOrderAmendment(entryId: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to abandon an amendment");
  const s = await createClient();
  const { data, error } = await s.rpc("abandon_order_amendment", { p_entry: entryId });
  if (error) return fail(error.message);
  await writeAudit({
    action: "order_amendment.abandoned",
    entityType: "order_budget_revision",
    entityId: entryId,
  });
  rev();
  return { ok: true, id: entryId, outcome: String(data ?? "") };
}
