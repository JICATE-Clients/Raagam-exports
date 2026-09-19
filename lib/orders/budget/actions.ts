"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  bomRefusalOf,
  budgetReopenInput,
  canReopen,
  canTransition,
  orderBudgetInput,
  type BudgetLine,
  type BudgetReopenInput,
  type BudgetStatus,
  type CopyableBudget,
  type OrderBudgetInput,
} from "./types";
import {
  budgetFiguresOf,
  fabricProcessBreakdown,
  getOrderBudget,
  pullCostLines,
  type FabricProcessGroup,
  type PulledCostLine,
} from "./service";
import { isRefusal } from "./totals";
import { mergePulled, pullMergeIsEmpty, pullMergeSize } from "./pull-merge";
import { budgetBaseline, kpisToJson } from "./amendment";
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
    // 0572. `currency_code` / `ex_rate` arrive already paired, and INR already
    // folded to null, by `budgetLineInput` — `chk_obl_currency_pair` is the
    // same rule underneath.
    specification: clean(l.specification),
    currency_code: l.currency_code ?? null,
    ex_rate: l.currency_code ? (l.ex_rate ?? null) : null,
    is_foc: l.is_foc,
    is_import: l.is_import,
    // 0573 — Process Rates. A blank multiplier is stored NULL, which is 1.
    process_id: l.process_id ?? null,
    basis: l.basis ?? null,
    combo: clean(l.combo),
    rate_type: l.rate_type,
    no_of_pcs: l.no_of_pcs ?? null,
    no_of_units: l.no_of_units ?? null,
    style_ref_no: clean(l.style_ref_no),
    component_id: l.component_id ?? null,
    // 0574 — the CMT breakup. `rate` above is already its sum (the schema's
    // transform), which is what `chk_obl_cmt_breakup` requires.
    cutting_rate: l.cutting_rate ?? null,
    making_rate: l.making_rate ?? null,
    checking_rate: l.checking_rate ?? null,
    ironing_rate: l.ironing_rate ?? null,
    packing_rate: l.packing_rate ?? null,
    // 0575 — the Expense / Income Head.
    cost_head_id: l.cost_head_id ?? null,
    // 0590 — the yarn stage.
    stage_id: l.stage_id ?? null,
    // 0591 — pulled from a BOM (item / qty / unit are the BOM's).
    from_bom: l.from_bom,
  }));

  if (lines.length) {
    const { error } = await s.from("order_budget_lines").insert(lines);
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/**
 * THE PREREQUISITE GATE (user 2026-09-19): every order on a budget has a SAVED
 * Fabric BOM and a SAVED Material BOM. The picker hides the others; this is the
 * half a stale tab, a second window and a crafted post still have to pass, the
 * same split as the duplicate-name guard.
 *
 * Returns the refusal naming every order that fails, or null.
 */
async function refuseUnreadyOrders(
  s: Awaited<ReturnType<typeof createClient>>,
  orderIds: readonly string[],
): Promise<Result | null> {
  if (orderIds.length === 0) return null;
  const ids = [...orderIds];
  const [fab, mat, named] = await Promise.all([
    s.from("order_fabric_boms").select("garment_order_id").eq("is_draft", false).in("garment_order_id", ids),
    s.from("material_bom_amendments").select("garment_order_id").eq("is_draft", false).in("garment_order_id", ids),
    s
      .from("garment_order_amendments")
      .select("id, code, sales_order:sales_orders(order_number)")
      .in("id", ids),
  ]);
  // A FAILED READ REFUSES. Passing on an error would open the gate on a query
  // that never ran.
  for (const r of [fab, mat, named]) if (r.error) return fail(`Could not check the orders' BOMs: ${r.error.message}`);
  const has = (rows: unknown[] | null) =>
    new Set(((rows ?? []) as { garment_order_id: string }[]).map((r) => r.garment_order_id));
  const fabric = has(fab.data);
  const material = has(mat.data);
  const label = new Map(
    ((named.data ?? []) as unknown as { id: string; code: string | null; sales_order: { order_number: string | null } | null }[]).map(
      (o) => [o.id, o.sales_order?.order_number ?? o.code ?? "an order"],
    ),
  );
  const refused = ids.flatMap((id) => {
    const why = bomRefusalOf(fabric.has(id), material.has(id));
    return why ? [`${label.get(id) ?? "an order"}: ${why}`] : [];
  });
  return refused.length === 0
    ? null
    : fail(`Save both BOMs before budgeting — ${refused.join("; ")}`);
}

/**
 * A cost line must belong to an order ON THE BUDGET, or to none (a whole-group
 * overhead). A line keyed to an order that was removed would be costed into the
 * totals of an order the budget no longer sells, so it is refused rather than
 * saved.
 */
function refuseOrphanLines(data: OrderBudgetInput): Result | null {
  const onBudget = new Set(data.orders.map((o) => o.garment_order_id));
  const orphans = data.lines.filter((l) => l.garment_order_id && !onBudget.has(l.garment_order_id));
  return orphans.length === 0
    ? null
    : fail(
        `${orphans.length} cost line${orphans.length === 1 ? " belongs" : "s belong"} to an order no longer on this budget — remove ${orphans.length === 1 ? "it" : "them"}, or add the order back`,
      );
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
  const orphan = refuseOrphanLines(p.data);
  if (orphan) return orphan;

  const s = await createClient();
  const unready = await refuseUnreadyOrders(s, p.data.orders.map((o) => o.garment_order_id));
  if (unready) return unready;
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

  const orphan = refuseOrphanLines(p.data);
  if (orphan) return orphan;

  const s = await createClient();
  const guard = await assertEditable(s, id);
  if (!guard.ok) return guard;
  const unready = await refuseUnreadyOrders(s, p.data.orders.map((o) => o.garment_order_id));
  if (unready) return unready;

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
  /* A ONCE-APPROVED BUDGET KEEPS ITS HISTORY (0576) — see `canDeleteBudget`.
     Said here, with the count, before the database's own refusal would say it
     mid-delete. */
  const { count, error: revErr } = await s
    .from("order_budget_revisions")
    .select("id", { count: "exact", head: true })
    .eq("budget_id", id);
  if (revErr) return fail(revErr.message);
  if ((count ?? 0) > 0) {
    return fail(
      `This budget has an approved history (${count} revision${count === 1 ? "" : "s"}) and cannot be deleted — keep it, or reopen and revise it.`,
    );
  }
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
  //
  // THE SUMMARY THE APPROVER APPROVES AGAINST (0576, doc §4.2) is computed
  // here, from the stored budget, by `budgetFiguresOf` — the SAME assembler
  // the screen calls (`./figures`), so the KPIs the MD reads are, figure for
  // figure, what the merchandiser saw. It is stored on the row
  // (`submitted_summary`) in the same write as the status, and handed to the
  // approval run as its context below.
  let budget: Awaited<ReturnType<typeof getOrderBudget>>;
  let figures: Awaited<ReturnType<typeof budgetFiguresOf>>;
  try {
    budget = await getOrderBudget(id);
    if (!budget) return fail("That budget no longer exists");
    if (budget.lines.length === 0) return fail("Add at least one cost line before submitting");
    figures = await budgetFiguresOf(budget);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The budget's figures could not be worked out");
  }
  /* THE BUDGET SENT FOR APPROVAL IS THE BOMs' CURRENT ANSWER (0591). A pulled
     line's quantity is read-only on the screen, so it is only right while it
     still matches the BOM. The screen offers "Refresh from BOMs"; this is the
     half a stale tab cannot skip. The same `mergePulled` the screen applies,
     run against the STORED lines: anything it would change (a moved quantity, a
     new BOM line, a stale one, a re-fit fabric process) refuses the submit. */
  const orderIds = budget.orders.map((o) => o.garment_order_id);
  const unready = await refuseUnreadyOrders(s, orderIds);
  if (unready) return unready;
  try {
    const { lines: freshLines } = await pullCostLines(orderIds);
    const drift = mergePulled(
      budget.lines.map((l) => ({ ...l, key: l.id, qty: l.qty == null ? null : Number(l.qty) })),
      freshLines,
    );
    if (!pullMergeIsEmpty(drift)) {
      const n = pullMergeSize(drift);
      return fail(
        `The BOMs have changed since this budget was filled (${n} line${n === 1 ? "" : "s"}) — open it, press Refresh from BOMs, and save before sending it`,
      );
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The BOMs could not be read to check this budget");
  }

  const { totals } = figures;
  const summary = kpisToJson(figures.kpis);

  /* THE SNAPSHOT IS REWRITTEN FROM THE SAME FACTS. The approval screen values
     the orders from `order_budget_orders.sales_value` (the approver sees what
     was submitted, 0428), and that snapshot was taken at the last SAVE — an
     order re-priced between save and submit would otherwise give the approver
     one total and the stored summary another. Written while the budget is
     still draft, before the status moves (0576 freezes it once approved). */
  const byOrder = new Map(figures.facts.map((o) => [o.id, o] as const));
  for (const o of budget.orders) {
    const f = byOrder.get(o.garment_order_id);
    if (!f) continue;
    const { error: snapErr } = await s
      .from("order_budget_orders")
      .update({
        sales_value: f.sales_value,
        // `chk_obo_value_or_reason` (0428): exactly one of the two.
        sales_refusal: f.sales_value == null ? (f.sales_refusal ?? "this order has no value yet") : null,
      })
      .eq("id", o.id);
    if (snapErr) return fail(snapErr.message);
  }

  const { error } = await s
    .from("order_budgets")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: (await getAppUser())?.id ?? null,
      submitted_summary: summary,
    })
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
  const started = await startApproval({
    workflowKey: WORKFLOWS.order_budget.key,
    subjectTable: WORKFLOWS.order_budget.subjectTable,
    subjectId: id,
    /* EVERY KEY A FLOW MIGHT TEST, passed whether or not one tests it today. A
       MISSING key does not match — it falls through to the catch-all rather than
       mis-routing — so the cost of sending an unused key is nothing, and the
       cost of omitting one is a flow that silently never fires. */
    context: {
      /* A cost that REFUSES (a pending percent line, 0575) goes as null, not
         as a number: a flow testing `total_cost > X` must not match on a
         partial sum. The refusal's sentence is in `kpis`. */
      total_cost: isRefusal(totals.cost) ? null : totals.cost,
      currency_code: budget.currency_code ?? null,
      unpriced_lines: totals.unpriced.length,
      /* THE §4.2 SUMMARY — what the approval notification shows and what
         `submitted_summary` stores. The same JSON, so the push, the queue and
         the stored record cannot disagree. */
      kpis: summary,
    },
    /* The unit narrows WHO holds the approving role (0500). A budget with no
       location falls back to every holder of the role, which is right: an
       unscoped document is not one unit's business. */
    scope: budget.location_id ? { location_id: budget.location_id } : {},
  });

  if (!started.ok) {
    await s
      .from("order_budgets")
      .update({ status: "draft", submitted_at: null, submitted_by: null, submitted_summary: null })
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

/**
 * Send a budget back to draft.
 *
 * ## TWO DIFFERENT ACTS BEHIND ONE BUTTON
 *
 * - A REJECTED budget goes back to its author to be reworked — the ordinary
 *   `canTransition` step, gated on `edit`: reworking it is the author's job, and
 *   the approver has already had their say.
 * - An APPROVED budget goes back only through the AMENDMENT PROTOCOL (0576):
 *   `protocol` is required (who asked, what kind of change, why), the action is
 *   gated on `orders:approve` (undoing an approval is the approver's act), and
 *   `reopen_order_budget()` records the revision — with the APPROVED BASELINE
 *   computed here — and moves the status in ONE transaction. That status
 *   change is what unlocks the budget's orders (0576's sync trigger).
 *
 * THE BASELINE IS COMPUTED ON THE SERVER, from the stored budget, by the same
 * assembler the screen uses (`budgetFiguresOf` → `./figures`) — never taken
 * from the client, whose copy could be stale or edited. The budget is frozen
 * while approved and its orders are locked, so the figures computed now ARE
 * the approved figures.
 */
export async function reopenBudget(
  id: string,
  protocol?: BudgetReopenInput,
): Promise<Result & { revisionNo?: number }> {
  const s = await createClient();

  const from = await readStatus(s, id);
  if (!from) return fail("That budget no longer exists");

  if (canReopen(from)) {
    if (!(await can("orders", "approve"))) {
      return fail("You do not have permission to reopen an approved budget");
    }
    const p = budgetReopenInput.safeParse(protocol ?? {});
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Say why the budget is being reopened");

    let baseline: unknown;
    try {
      const budget = await getOrderBudget(id);
      if (!budget) return fail("That budget no longer exists");
      const figures = await budgetFiguresOf(budget);
      baseline = budgetBaseline({ kpis: figures.kpis, general: figures.general, lines: budget.lines });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "The approved figures could not be worked out");
    }

    const { data, error } = await s.rpc("reopen_order_budget", {
      p_budget_id: id,
      p_source: p.data.source,
      p_type: p.data.amendment_type,
      p_reason: p.data.reason,
      p_baseline: baseline,
    });
    if (error) return fail(error.message);
    const revisionNo = Number(data);

    await writeAudit({
      action: "order_budget.reopened",
      entityType: "order_budget",
      entityId: id,
    });
    rev();
    return { ok: true, id, revisionNo };
  }

  if (!(await can("orders", "edit"))) return fail("Forbidden");
  if (!canTransition(from, "draft")) {
    return fail(`A ${from} budget is already editable`);
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
  let pulled: Awaited<ReturnType<typeof pullCostLines>>;
  try {
    pulled = await pullCostLines(garmentOrderIds);
  } catch (e) {
    // A READ THAT FAILED IS SAID, not reported as "no recorded BOM yet" — the
    // sentence below that an empty result would otherwise produce.
    return { ok: false, error: e instanceof Error ? e.message : "The BOMs could not be read" };
  }
  const { lines, skipped } = pulled;
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

// ---------------------------------------------------------------------------
// Copy From — an earlier budget's lines as a starting point
// ---------------------------------------------------------------------------

/**
 * Every budget, labelled well enough to pick one to copy rates from.
 *
 * NOTHING IS EXCLUDED BY STATUS. An approved budget is the best source of
 * rates there is — it is the one somebody signed — and a rejected one may
 * still hold the right prices for the lines that were not the problem. Which
 * budget is being edited is the screen's to filter; this has no budget in
 * scope.
 */
export async function listCopyableBudgets(): Promise<
  { ok: true; budgets: CopyableBudget[] } | { ok: false; error: string }
> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data, error } = await s
    .from("order_budgets")
    .select(
      "id, code, budget_date, description, status, " +
        "lines:order_budget_lines(id), " +
        "orders:order_budget_orders(sno, garment_order:garment_order_amendments(" +
        "customer:customers(name), sales_order:sales_orders(order_number), " +
        // Named FK column — see `listBudgetableOrders`.
        "sq_detail:sq_details!sq_detail_id(code)))",
    )
    .order("budget_date", { ascending: false })
    .order("created_at", { ascending: false });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — an empty picker reads as
  // "there is nothing to copy from", which is believable and wrong.
  if (error) return { ok: false, error: `Could not read the budgets: ${error.message}` };

  type Row = {
    id: string;
    code: string | null;
    budget_date: string;
    description: string | null;
    status: BudgetStatus;
    lines: { id: string }[] | null;
    orders:
      | {
          sno: number;
          garment_order: {
            customer: { name: string } | null;
            sales_order: { order_number: string | null } | null;
            sq_detail: { code: string | null } | null;
          } | null;
        }[]
      | null;
  };

  const budgets = ((data ?? []) as unknown as Row[]).map((b): CopyableBudget => {
    const first = [...(b.orders ?? [])].sort((a, c) => a.sno - c.sno)[0]?.garment_order ?? null;
    return {
      id: b.id,
      code: b.code,
      budget_date: b.budget_date,
      description: b.description,
      status: b.status,
      order_count: b.orders?.length ?? 0,
      line_count: b.lines?.length ?? 0,
      first_order: first
        ? {
            re_no: first.sales_order?.order_number ?? null,
            sq_no: first.sq_detail?.code ?? null,
            customer_name: first.customer?.name ?? null,
          }
        : null,
    };
  });
  return { ok: true, budgets };
}

/**
 * One budget's lines, in `sno` order, for `copyRatesFrom` to match against.
 *
 * Read-only and gated on `view`, like `loadCostLines`: copying writes nothing
 * until the operator saves the budget they are editing, and that save passes
 * `createOrderBudget` / `updateOrderBudget`'s own gates.
 */
export async function loadBudgetLinesForCopy(
  budgetId: string,
): Promise<{ ok: true; lines: BudgetLine[] } | { ok: false; error: string }> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_lines")
    .select("*")
    .eq("budget_id", budgetId)
    .order("sno", { ascending: true });
  if (error) return { ok: false, error: `Could not read that budget's lines: ${error.message}` };
  const lines = (data ?? []) as BudgetLine[];
  if (lines.length === 0) {
    // EMPTY-AND-EXPLAIN: a copy that silently changed nothing reads as a copy
    // that worked.
    return { ok: false, error: "That budget has no lines to copy" };
  }
  return { ok: true, lines };
}

// ---------------------------------------------------------------------------
// Fabric Processes — the breakdown a group re-splits from
// ---------------------------------------------------------------------------

/**
 * Every fabric process of these orders at FULL grain (process × fabric ×
 * colourway × panel), for the screen to re-split a group when the operator
 * changes For (`splitFabricProcess`).
 *
 * `refusals` are the report's own sentences for weights it could not place —
 * the screen should show them rather than let a re-split look complete.
 * Gated on `view` like `loadCostLines`: it reads, and writes nothing.
 */
export async function loadFabricProcessBreakdown(
  garmentOrderIds: string[],
): Promise<
  { ok: true; groups: FabricProcessGroup[]; refusals: string[] } | { ok: false; error: string }
> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (garmentOrderIds.length === 0) {
    return { ok: false, error: "Add the garment orders first — the processes come from their Fabric BOMs" };
  }
  try {
    const { groups, refusals } = await fabricProcessBreakdown(garmentOrderIds);
    return { ok: true, groups, refusals };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The Fabric BOMs could not be read" };
  }
}
