"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { budgetBaseline } from "@/lib/orders/budget/amendment";
import { budgetFiguresOf, getOrderBudget } from "@/lib/orders/budget/service";
import { orderAmendmentOf, orderLockOf } from "@/lib/orders/budget/lock";
import { kindsForSelection } from "@/lib/orders/amendments/amendment-entry";
import { captureVFinal } from "@/lib/orders/amendments/v-final";
import { recalculateDownstream } from "@/lib/orders/amendments/recalc-downstream";
import { raiseAmendmentInput, type RaiseAmendmentInput } from "./types";

type Result =
  | {
      ok: true;
      id?: string;
      entryNo?: string;
      outcome?: string;
      /** Reports whose approved version could not be frozen at raise (they print a warning instead). */
      vFinalMissing?: string[];
    }
  | { ok: false; error: string };
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
  if (!(await can("orders", "edit"))) return fail("You do not have permission to revise an order");
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
  if (!lock && !amending) return fail("This order is not approved, so it needs no revision — edit it directly");
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
    /* THE MODULES BECOME KINDS HERE (0619): Order Entry's detail, then one
       kind per other module picked. The RPC freezes their union. */
    p_types: kindsForSelection({ modules: p.data.modules, orderKinds: p.data.order_kinds }),
    p_reason: p.data.remarks,
    p_baseline: baseline,
  });
  if (error) return fail(error.message);
  const row = ((data ?? []) as { entry_id: string; entry_no: string | null }[])[0];
  if (!row) return fail("The revision was not recorded");

  /* V_FINAL IS FROZEN NOW, on the FIRST raise only (spec §4B): this is the one
     moment the live rows are the approved version — the RE was locked until
     the RPC above returned. A superseding raise does not capture (the live
     rows are already amended); the RPC copies the old entry's V_final instead.
     A capture that fails does NOT undo the raise — the reports it missed say
     so on their own pages ('missing'), and the toast names them. */
  let vFinalMissing: string[] | undefined;
  if (lock) {
    const { data: so } = await s
      .from("garment_order_amendments")
      .select("sales_order_id")
      .eq("id", p.data.order_id)
      .maybeSingle();
    const salesOrderId = (so as { sales_order_id: string | null } | null)?.sales_order_id;
    if (salesOrderId) {
      const failed = await captureVFinal(row.entry_id, salesOrderId);
      if (failed.length) {
        vFinalMissing = failed.map((f) => f.source);
        console.error("[order-amendments] V_final capture:", failed);
      }
    }
  }

  await writeAudit({
    action: "order_amendment.raised",
    entityType: "order_budget_revision",
    entityId: row.entry_id,
  });
  rev();
  return { ok: true, id: row.entry_id, entryNo: row.entry_no ?? undefined, vFinalMissing };
}

/**
 * ABANDON an open entry (`abandon_order_amendment`, 0616 · 0619). Since 0619
 * the order, both BOMs and the budget are REVERTED to V0 and the RE re-locks
 * ('restored'). An entry raised before 0619 has no budget snapshot and keeps
 * the old rules: nothing changed → restored; something changed → the RE stays
 * open with its budget in draft ('reopened'). Refused while with the MD.
 */
export async function abandonOrderAmendment(entryId: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to abandon a revision");
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

/**
 * RECALCULATE the amended order's BOMs now (0619, spec §3.1) — the Amendment
 * Entry page's button, for the recalculation Order Entry's save runs by
 * itself. Derived rows only (`recalculateDownstream`), so it is legal whether
 * or not the amendment picked the BOMs. Also what "forces a recalculation of
 * yarn purchase weights before submission" is satisfied by (spec §2).
 */
export async function recalculateAmendmentBoms(
  entryId: string,
): Promise<{ ok: true; done: string[]; manualEntries: string[] } | { ok: false; error: string }> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "You do not have permission to recalculate" };
  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_revisions")
    .select("garment_order_id, outcome")
    .eq("id", entryId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row = data as { garment_order_id: string | null; outcome: string } | null;
  if (!row?.garment_order_id) return { ok: false, error: "That revision is not against an order" };
  if (row.outcome !== "open") return { ok: false, error: "That revision is closed — nothing to recalculate" };
  try {
    const r = await recalculateDownstream(row.garment_order_id);
    rev();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The BOMs could not be recalculated" };
  }
}
