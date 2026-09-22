import "server-only";
import { createClient } from "@/lib/supabase/server";
import { orderLockMessage } from "./amendment";
import {
  amendmentTypesLabel,
  areaOpen,
  outOfScopeMessage,
  scopeFromJson,
  type AmendmentArea,
  type FrozenScope,
} from "@/lib/orders/amendments/amendment-entry";

/**
 * THE APPROVAL LOCK, READ FROM THE SERVER — the courtesy half (0576).
 *
 * When a budget is approved, its orders' `re_status` becomes `approved`, and
 * 0576's triggers refuse every write to the order, its Fabric BOM and its
 * Material BOM — parents and child grids alike. THE TRIGGER IS THE GUARD.
 * These functions exist so a write action can refuse with a sentence BEFORE
 * its first write: Order Entry saves by deleting and re-inserting ~20 child
 * grids, and a refusal from the trigger halfway through reads as a half-run
 * save rather than as a lock.
 *
 * ## IT ASKS THE DATABASE'S OWN QUESTION
 *
 * `order_lock_of()` — the function the triggers call — never a re-derivation
 * from the budget tables here: a second definition could disagree with the
 * trigger the database actually enforces, and the guard would wave through a
 * save the database then refuses, or the reverse.
 *
 * ## A FAILED READ REFUSES (fails CLOSED)
 *
 * "Could not check" is not "unlocked". Waving the write through would still be
 * caught by the trigger, but mid-save — exactly the half-run this module
 * exists to prevent — so the action stops here and says why.
 */

/** Where an approved order's lock comes from. */
export type OrderLock = {
  /** `sales_orders.order_number` — the RE No the message names. */
  reNo: string | null;
  budgetId: string;
  budgetCode: string | null;
  /** `order_budgets.decided_at` of the approval — ISO timestamp. */
  approvedAt: string | null;
};

/**
 * Is this garment order locked by an approved budget? Null when it is not.
 *
 * READ THROUGH `order_lock_of()` (0576), the SAME function every lock trigger
 * reads — so "locked" has one definition, and it includes the RE-level rule:
 * this document OR any document of the same RE No that is approved. A second
 * definition here (reading only this row's `re_status`) would wave through an
 * amendment document the trigger then refuses.
 */
export async function orderLockOf(orderId: string): Promise<OrderLock | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("order_lock_of", { p_order: orderId });
  if (error) throw new Error(`Could not read whether this order is locked: ${error.message}`);
  const row = ((data ?? []) as {
    locked_order_id: string;
    re_no: string | null;
    budget_id: string | null;
    budget_code: string | null;
    approved_at: string | null;
  }[])[0];
  if (!row) return null;
  return {
    reNo: row.re_no,
    // `re_status` approved with no approved budget readable: still locked (the
    // trigger says so) — the message just cannot name the budget.
    budgetId: row.budget_id ?? "",
    budgetCode: row.budget_code,
    approvedAt: row.approved_at,
  };
}

/** The open Amendment Entry scoping an order — `order_amendment_scope_of` (0604 · 0616). */
export type OrderAmendment = {
  entryId: string;
  entryNo: string | null;
  types: string[];
  scope: FrozenScope;
};

/**
 * Is an Amendment Entry open over this order's RE No? Null when none is.
 *
 * READ THROUGH `order_amendment_scope_of()` — the same `order_amendment_of`
 * the trigger consults, at the same RE grain, returning the FROZEN scope the
 * trigger will enforce. Re-deriving the scope here from the seed would let a
 * later seed edit widen what the screen shows without widening what the
 * database accepts.
 */
export async function orderAmendmentOf(orderId: string): Promise<OrderAmendment | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("order_amendment_scope_of", { p_order: orderId });
  if (error) throw new Error(`Could not read whether this order is being amended: ${error.message}`);
  const row = ((data ?? []) as {
    entry_id: string;
    entry_no: string | null;
    amendment_type: string;
    amendment_types: string[] | null;
    scope: unknown;
  }[])[0];
  if (!row) return null;
  return {
    entryId: row.entry_id,
    entryNo: row.entry_no,
    types: row.amendment_types?.length ? row.amendment_types : [row.amendment_type],
    scope: scopeFromJson(row.scope),
  };
}

/**
 * The guard a write action calls BEFORE its first write — with the AREA it is
 * about to write, because since 0604 "locked" has three answers:
 *
 *   open      → pass
 *   approved  → refuse with the lock sentence
 *   amending  → pass if the open entry's scope opens this AREA, else refuse
 *               with the out-of-scope sentence (the trigger's own words)
 *
 * NO CALL SITE MAY PASS A CONSTANT "ANY": a guard phrased as "restrict only in
 * case X" leaks through every state that is not X. Each action names the
 * document it writes. Inside an open area the trigger still judges every row
 * and column — this is the courtesy that stops a half-run save, not the lock.
 *
 * `null` / `undefined` passes: a Material BOM with no order is not locked by
 * any budget (0576's parent trigger lets it through too).
 */
export async function assertOrderWritable(
  orderId: string | null | undefined,
  area: AmendmentArea,
): Promise<{ ok: true; amendment: OrderAmendment | null } | { ok: false; error: string }> {
  if (!orderId) return { ok: true, amendment: null };
  try {
    const lock = await orderLockOf(orderId);
    if (lock) return { ok: false, error: orderLockMessage(lock) };
    const amendment = await orderAmendmentOf(orderId);
    if (amendment && !areaOpen(amendment.scope, area)) {
      return { ok: false, error: outOfScopeMessage(amendment, area) };
    }
    return { ok: true, amendment };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not check the order's lock" };
  }
}

/** A budget over this order that has been REOPENED and not yet re-approved. */
export type ReopenedBudget = {
  budgetId: string;
  budgetCode: string | null;
  revisionNo: number;
  /** The Amendment Protocol reason the operator gave for reopening. */
  reason: string;
  /** The Amendment Entry No (AMD/26-27/0001) when the merchandiser's door raised it; null from Budget ▸ Reopen before 0604. */
  entryNo: string | null;
  /** Its Change Categories — "Price Change", "Quantity Addition + …". */
  typesLabel: string;
};

/**
 * The PO gate's question (decision 3): is this order's budget reopened?
 *
 * "Reopened" = the budget HAS a revision (it was approved once and sent back
 * through the Amendment Protocol) and is NOT approved now. A budget never
 * approved has no revision, so an order with no approved budget stays
 * purchasable exactly as today. The LATEST revision's reason is returned, so
 * the refusal can say why the numbers are moving.
 *
 * Throws on a failed read — the caller refuses rather than letting a PO
 * through on an unanswered question.
 */
export async function reopenedBudgetForOrder(orderId: string): Promise<ReopenedBudget | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_orders")
    .select(
      "budget:order_budgets!inner(id, code, status, " +
        "revisions:order_budget_revisions(revision_no, reason, entry_no, amendment_type, amendment_types))",
    )
    .eq("garment_order_id", orderId);
  if (error) throw new Error(`Could not read whether this order's budget is reopened: ${error.message}`);

  type Row = {
    budget: {
      id: string;
      code: string | null;
      status: string;
      revisions: {
        revision_no: number;
        reason: string;
        entry_no: string | null;
        amendment_type: string;
        amendment_types: string[] | null;
      }[] | null;
    } | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    const b = r.budget;
    if (!b || b.status === "approved" || !b.revisions?.length) continue;
    const last = [...b.revisions].sort((a, c) => c.revision_no - a.revision_no)[0];
    return {
      budgetId: b.id,
      budgetCode: b.code,
      revisionNo: last.revision_no,
      reason: last.reason,
      entryNo: last.entry_no,
      typesLabel: amendmentTypesLabel(
        last.amendment_types?.length ? last.amendment_types : [last.amendment_type],
      ),
    };
  }
  return null;
}
