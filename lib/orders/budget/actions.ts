"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  canTransition,
  orderBudgetInput,
  type BudgetStatus,
  type OrderBudgetInput,
} from "./types";
import { pullCostLines, type PulledCostLine } from "./service";
import { budgetTotals } from "./totals";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

function rev(): void {
  revalidatePath("/orders/budgets");
  revalidatePath("/orders/budget-approval");
  revalidatePath("/orders/setup");
  /* The decision changes two screens, and the other one is the approver's queue
     (AGENTS.md has no rule for this; the engine does). */
  revalidatePath("/approvals");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Writing the document
// ---------------------------------------------------------------------------

function headerOnly(data: OrderBudgetInput) {
  return {
    budget_date: data.budget_date,
    description: clean(data.description),
    currency_code: clean(data.currency_code),
    exchange_rate: data.exchange_rate,
    remark: clean(data.remark),
  };
}

async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  budgetId: string,
  data: OrderBudgetInput,
): Promise<Result> {
  for (const t of ["order_budget_lines", "order_budget_orders"]) {
    const { error } = await s.from(t).delete().eq("budget_id", budgetId);
    if (error) return fail(error.message);
  }

  const orders = data.orders.map((o, i) => ({
    budget_id: budgetId,
    garment_order_id: o.garment_order_id,
    sno: i + 1,
    sales_value: o.sales_value,
    // `chk_obo_value_or_reason` (0428) requires exactly one of the two. An order
    // that could not be valued and carries no reason would violate it, so the
    // fallback sentence is here rather than left to the caller — the screen
    // always sends one, and `lib/data-io` would not.
    sales_refusal:
      o.sales_value == null ? (clean(o.sales_refusal) ?? "this order has no value yet") : null,
  }));

  const { error: ordErr } = await s.from("order_budget_orders").insert(orders);
  if (ordErr) return fail(ordErr.message);

  const lines = data.lines.map((l, i) => ({
    budget_id: budgetId,
    sno: i + 1,
    source: l.source,
    garment_order_id: l.garment_order_id ?? null,
    item_id: l.item_id ?? null,
    description: clean(l.description),
    qty: l.qty ?? null,
    uom_id: l.uom_id ?? null,
    rate: l.rate ?? null,
    notes: clean(l.notes),
  }));

  if (lines.length) {
    const { error } = await s.from("order_budget_lines").insert(lines);
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/**
 * A budget may only be edited while it is the operator's.
 *
 * ONE CHECK, READ BEFORE EVERY WRITE. A submitted budget sitting in the
 * approver's queue must not move under them, and an approved one is the document
 * purchase is acting on — editing it would move a ceiling under a PO that had
 * already been placed. The screen disables its footer, and this is the half that
 * a stale tab, a second window and `lib/data-io` all still have to pass.
 */
async function assertEditable(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<Result> {
  const { data } = await s.from("order_budgets").select("status").eq("id", id).maybeSingle();
  if (!data) return fail("That budget no longer exists");
  const status = data.status as BudgetStatus;
  if (status === "draft" || status === "rejected") return { ok: true };
  return fail(
    status === "submitted"
      ? "This budget is with the approver — it cannot be changed until it comes back"
      : "An approved budget cannot be changed. Raise a new one to revise it",
  );
}

export async function createOrderBudget(data: OrderBudgetInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderBudgetInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const { data: created, error } = await s
    .from("order_budgets")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create the budget");

  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_budget.created",
    entityType: "order_budget",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateOrderBudget(id: string, data: OrderBudgetInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = orderBudgetInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const guard = await assertEditable(s, id);
  if (!guard.ok) return guard;

  const { error } = await s.from("order_budgets").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({ action: "order_budget.updated", entityType: "order_budget", entityId: id });
  rev();
  return { ok: true, id };
}

export async function deleteOrderBudget(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const guard = await assertEditable(s, id);
  if (!guard.ok) return guard;
  const { error } = await s.from("order_budgets").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The workflow — step 6
// ---------------------------------------------------------------------------

async function readStatus(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<BudgetStatus | null> {
  const { data } = await s.from("order_budgets").select("status").eq("id", id).maybeSingle();
  return (data?.status as BudgetStatus | undefined) ?? null;
}

/** Send a draft to the approver. Gated on `edit` — submitting is the author's
 *  act, not the approver's. */
export async function submitBudget(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const s = await createClient();

  const from = await readStatus(s, id);
  if (!from) return fail("That budget no longer exists");
  if (!canTransition(from, "submitted")) {
    // NAMES THE STATE IT IS IN. "Cannot submit" leaves the operator staring at a
    // button; "already with the approver" tells them what happened — usually a
    // second click, or a second tab.
    return fail(`This budget is ${from === "submitted" ? "already with the approver" : from}`);
  }

  // A BUDGET WITH NO LINES IS NOT A BUDGET. Checked here and not only on screen,
  // because "submitted" is what puts it in front of someone else.
  //
  // `source, qty, rate` rather than `id`, because the same read now feeds the
  // approval context below — a second query for the same rows would be a second
  // chance for the two to disagree about what this budget is worth.
  const { data: lines } = await s
    .from("order_budget_lines")
    .select("source, qty, rate")
    .eq("budget_id", id);
  if ((lines ?? []).length === 0) return fail("Add at least one cost line before submitting");

  const { error } = await s
    .from("order_budgets")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: (await getAppUser())?.id ?? null })
    .eq("id", id);
  if (error) return fail(error.message);

  /**
   * START THE APPROVAL RUN — the first of the engine's two seams (0500–0505).
   *
   * ## IN THE SAME ACTION AS THE STATUS WRITE, DELIBERATELY
   *
   * "Submitted" MEANS "in front of an approver". A budget that reached
   * `submitted` with no run is in nobody's queue and nobody is being asked —
   * the stranded-document failure the whole engine exists to prevent, arriving
   * through the one door the engine cannot guard.
   *
   * ## SO A FAILURE HERE ROLLS THE STATUS BACK
   *
   * There is no transaction across two PostgREST calls, so the rollback is
   * written by hand. Leaving the budget `submitted` after a failed start would
   * be exactly that stranded document, and it would be invisible: the operator
   * saw a success toast, the list says submitted, and no queue holds it.
   * Putting it back to `draft` returns the operator to a state they can act on
   * — press Submit again — which is the only honest outcome.
   *
   * `no_flow` is NOT swallowed. 0503 seeds a catch-all per workflow so it should
   * be unreachable; if it ever fires, the budget goes back to draft and the
   * message names the cause rather than the document quietly sitting still.
   */
  const totals = budgetTotals(
    (lines ?? []) as { source: string | null; qty: number | null; rate: number | null }[],
    [],
  );
  const { data: budget } = await s
    .from("order_budgets")
    .select("currency_code, location_id")
    .eq("id", id)
    .single();

  const started = await startApproval({
    workflowKey: WORKFLOWS.order_budget.key,
    subjectTable: WORKFLOWS.order_budget.subjectTable,
    subjectId: id,
    /* EVERY KEY A FLOW MIGHT TEST, passed whether or not one tests it today. A
       MISSING key does not match — it falls through to the catch-all rather than
       mis-routing — so the cost of sending an unused key is nothing, and the
       cost of omitting one is a flow that silently never fires. */
    context: {
      total_cost: totals.cost,
      currency_code: budget?.currency_code ?? null,
      unpriced_lines: totals.unpriced.length,
    },
    /* The unit narrows WHO holds the approving role (0500). A budget with no
       location falls back to every holder of the role, which is right: an
       unscoped document is not one unit's business. */
    scope: budget?.location_id ? { location_id: budget.location_id } : {},
  });

  if (!started.ok) {
    await s
      .from("order_budgets")
      .update({ status: "draft", submitted_at: null, submitted_by: null })
      .eq("id", id);
    return fail(`Submitted, but no approval could be started — ${started.error}`);
  }

  await writeAudit({ action: "order_budget.submitted", entityType: "order_budget", entityId: id });
  rev();
  return { ok: true, id };
}

/**
 * Approve or reject.
 *
 * ## GATED ON `orders:approve`, WHICH NOTHING ELSE IN THIS REPO USES
 *
 * `lib/auth/types.ts` has declared the action since 0001 and every workflow
 * built since has gated on `edit` instead. A merchandiser who may edit a budget
 * is not thereby a person who may approve one, and `edit` grants approval to
 * everybody who can type in the document. 0428 seeds the permission row — the
 * policy would otherwise match nobody, forever, with the button simply dead.
 *
 * ## AN ORDER MAY BE IN ONLY ONE APPROVED BUDGET
 *
 * Two approved budgets covering one order means two cost ceilings downstream in
 * purchase. 0428 explains why this is not a unique index (the status is on the
 * parent and the order on the child, so a partial index cannot see the
 * condition) and puts the guard here. It NAMES the other budget: "already
 * budgeted" without saying where is a dead end.
 */
export async function decideBudget(
  id: string,
  decision: "approved" | "rejected",
  remark: string | null,
): Promise<Result> {
  if (!(await can("orders", "approve"))) {
    return fail("You do not have permission to approve budgets");
  }
  const s = await createClient();

  const from = await readStatus(s, id);
  if (!from) return fail("That budget no longer exists");
  if (!canTransition(from, decision)) {
    return fail(
      from === "draft"
        ? "This budget has not been submitted yet"
        : `This budget is already ${from}`,
    );
  }

  // A REJECTION MUST SAY WHY. An approval need not: "yes" is complete on its
  // own, and demanding a sentence for it trains people to type a full stop.
  if (decision === "rejected" && !remark?.trim()) {
    return fail("Say why this budget is being rejected");
  }

  if (decision === "approved") {
    const clash = await approvedClash(s, id);
    if (clash) return fail(clash);
  }

  const { error } = await s
    .from("order_budgets")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: (await getAppUser())?.id ?? null,
      decision_remark: clean(remark),
    })
    .eq("id", id);
  if (error) return fail(error.message);

  await writeAudit({
    action: `order_budget.${decision}`,
    entityType: "order_budget",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

/** Which order, and which budget already has it approved. Null when clear. */
async function approvedClash(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<string | null> {
  const { data: mine } = await s
    .from("order_budget_orders")
    .select("garment_order_id")
    .eq("budget_id", id);
  const ids = ((mine ?? []) as { garment_order_id: string }[]).map((r) => r.garment_order_id);
  if (ids.length === 0) return "This budget covers no orders";

  const { data: others } = await s
    .from("order_budget_orders")
    .select("garment_order_id, budget:order_budgets(id, code, status)")
    .in("garment_order_id", ids);

  type Row = {
    garment_order_id: string;
    budget: { id: string; code: string | null; status: string } | null;
  };
  const hit = ((others ?? []) as unknown as Row[]).find(
    (r) => r.budget && r.budget.id !== id && r.budget.status === "approved",
  );
  if (!hit) return null;

  const { data: order } = await s
    .from("garment_order_amendments")
    .select("code, sales_order:sales_orders(order_number)")
    .eq("id", hit.garment_order_id)
    .maybeSingle();
  type OrderRow = { code: string | null; sales_order: { order_number: string | null } | null };
  const o = order as unknown as OrderRow | null;
  const name = o?.sales_order?.order_number ?? o?.code ?? "one of these orders";

  return `${name} is already in approved budget ${hit.budget?.code ?? hit.budget?.id}. Remove it, or revise that budget instead`;
}

/** Send a rejected budget back to the author. Gated on `edit`: reworking it is
 *  the author's job, and the approver has already had their say. */
export async function reopenBudget(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const s = await createClient();

  const from = await readStatus(s, id);
  if (!from) return fail("That budget no longer exists");
  if (!canTransition(from, "draft")) {
    return fail(
      from === "approved"
        ? "An approved budget cannot be reopened. Raise a new one to revise it"
        : `A ${from} budget is already editable`,
    );
  }

  const { error } = await s
    .from("order_budgets")
    // The decision is CLEARED, not kept as history — `chk_ob_decision_matches_status`
    // (0428) requires it, and the reason behind the constraint is that a draft
    // carrying the last approver's name reads as approved in every list that
    // shows the column. The audit log is where the history lives.
    .update({ status: "draft", decided_at: null, decided_by: null, decision_remark: null })
    .eq("id", id);
  if (error) return fail(error.message);

  await writeAudit({ action: "order_budget.reopened", entityType: "order_budget", entityId: id });
  rev();
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Pulling the BOM costs
// ---------------------------------------------------------------------------

export type PullResult =
  | { ok: true; lines: PulledCostLine[]; skipped: number }
  | { ok: false; error: string };

/**
 * The Fabric and Material BOM requirements for the budget's orders.
 *
 * A SERVER ACTION rather than part of the form data: it depends on which orders
 * the operator has picked, which is state that only exists once the editor is
 * open.
 */
export async function loadCostLines(garmentOrderIds: string[]): Promise<PullResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (garmentOrderIds.length === 0) {
    return { ok: false, error: "Add the garment orders first — the costs come from their BOMs" };
  }
  const { lines, skipped } = await pullCostLines(garmentOrderIds);
  if (lines.length === 0) {
    // EMPTY-AND-EXPLAIN, and the two cases send the operator to different
    // screens: nothing recorded at all, versus recorded but every figure
    // refused.
    return {
      ok: false,
      error:
        skipped > 0
          ? `Every BOM figure for these orders is unanswered (${skipped} lines) — open the BOMs and fix them`
          : "These orders have no recorded Fabric or Material BOM yet",
    };
  }
  return { ok: true, lines, skipped };
}
