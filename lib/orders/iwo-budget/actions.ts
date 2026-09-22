"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { budgetTotals, isRefusal } from "@/lib/orders/budget/totals";
import { lineInputOf } from "@/lib/orders/budget/figures";
import { iwoMergeIsEmpty, mergeIwoPulled } from "./merge";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import { pullIwoCostLines } from "./service";
import type { IwoPullResult } from "./pull";
import { iwoBudgetInput, type IwoBudgetInput, type IwoBudgetLineRow } from "./types";
import { iwoBudgetProblems, keptIwoBudgetLines } from "./rules";

const PATH = "/orders/iwo-budgets";

/**
 * "Pull from BOM" / "Refresh from BOM" — the screen's one door to the pull.
 * Read-only: it returns the lines, and the budget's own Save writes them.
 */
export async function loadIwoCostLines(iwoId: string): Promise<IwoPullResult> {
  if (!(await can("orders", "view"))) return { refused: "Forbidden" };
  return pullIwoCostLines(iwoId);
}

type Result = { ok: true; budgetId: string } | { ok: false; error: string };

/**
 * Create (`budgetId` null) or update the budget of one IWO.
 *
 * THE IWO'S FOR IS READ FROM THE DATABASE, never taken from the screen — it
 * decides which sources the budget may carry (`rules.ts`).
 *
 * ONLY A DRAFT OR REJECTED BUDGET IS EDITED. Submitted and approved budgets
 * are the approver's (Phase 5 adds the approval flow and the BOM lock); this
 * refusal is here from the first save so no screen can edit one meanwhile.
 *
 * Lines are delete-then-insert, the order Budget's own write shape: nothing
 * cites a budget line's id.
 */
export async function saveIwoBudget(budgetId: string | null, payload: IwoBudgetInput): Promise<Result> {
  if (!(await can("orders", budgetId ? "edit" : "create"))) return { ok: false, error: "Forbidden" };
  const parsed = iwoBudgetInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const p = parsed.data;
  if (p.budget_date > today()) return { ok: false, error: "The budget date cannot be in the future." };

  const s = await createClient();
  const { data: iwo, error: iwoErr } = await s.from("internal_work_orders").select("iwo_for").eq("id", p.iwo_id).maybeSingle();
  if (iwoErr) return { ok: false, error: `Could not read the work order: ${iwoErr.message}` };
  const iwoFor = (iwo as { iwo_for: IwoFor } | null)?.iwo_for;
  if (!iwoFor) return { ok: false, error: "No Internal Work Order to budget." };

  const lines = keptIwoBudgetLines(p.lines);
  const problem = iwoBudgetProblems(lines, iwoFor)[0];
  if (problem) return { ok: false, error: problem.message };

  const header = { iwo_id: p.iwo_id, budget_date: p.budget_date, remark: p.remark || null };
  let id: string;
  if (!budgetId) {
    const { data, error } = await s
      .from("iwo_budgets")
      // location_id is overwritten from the IWO by 0594's guard; sent because
      // the column is NOT NULL and RLS reads it.
      .insert({ ...header, location_id: await iwoLocation(s, p.iwo_id) })
      .select("id")
      .single();
    if (error || !data) {
      return {
        ok: false,
        error: error?.code === "23505" ? "This work order already has a budget — open it from the list." : (error?.message ?? "Failed to create the budget"),
      };
    }
    id = data.id;
  } else {
    const { data: held, error: heldErr } = await s.from("iwo_budgets").select("status, iwo_id").eq("id", budgetId).maybeSingle();
    if (heldErr || !held) return { ok: false, error: heldErr?.message ?? "This budget no longer exists." };
    const h = held as { status: string; iwo_id: string };
    if (h.status !== "draft" && h.status !== "rejected") {
      return { ok: false, error: `This budget is ${h.status} — it can no longer be edited.` };
    }
    if (h.iwo_id !== p.iwo_id) return { ok: false, error: "A budget stays with its work order." };
    id = budgetId;
    // A rejected budget that is edited is a draft again.
    const { error } = await s.from("iwo_budgets").update({ ...header, status: "draft", decided_at: null, decided_by: null }).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: delErr } = await s.from("iwo_budget_lines").delete().eq("budget_id", id);
  if (delErr) return { ok: false, error: delErr.message };
  if (lines.length) {
    const { error } = await s.from("iwo_budget_lines").insert(
      lines.map((l, i) => ({
        budget_id: id,
        sno: i + 1,
        source: l.source,
        item_id: l.item_id,
        process_id: l.process_id,
        cost_head_id: l.cost_head_id,
        stage_id: l.stage_id,
        description: l.description || null,
        specification: l.specification || null,
        combo: l.combo || null,
        basis: l.basis,
        qty: l.qty,
        uom_id: l.uom_id,
        rate: l.rate,
        rate_type: l.rate_type,
        // 0572's pair: no currency means INR and carries no exchange rate.
        currency_code: l.currency_code || null,
        ex_rate: l.currency_code ? l.ex_rate : null,
        is_foc: l.is_foc,
        is_import: l.is_import,
        from_bom: l.from_bom,
      })),
    );
    if (error) return { ok: false, error: error.message };
  }

  await writeAudit({ action: budgetId ? "iwo_budget.updated" : "iwo_budget.created", entityType: "iwo_budget", entityId: id });
  revalidatePath(PATH);
  // The work order list shows this BOM / budget's state (2026-09-20).
  revalidatePath("/orders/internal-work-orders");
  return { ok: true, budgetId: id };
}

async function iwoLocation(s: Awaited<ReturnType<typeof createClient>>, iwoId: string): Promise<string | null> {
  const { data } = await s.from("internal_work_orders").select("location_id").eq("id", iwoId).single();
  return (data as { location_id: string | null } | null)?.location_id ?? null;
}

/** Only a draft or rejected budget is deleted; its lines cascade. */
export async function deleteIwoBudget(budgetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await can("orders", "delete"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data: held } = await s.from("iwo_budgets").select("status").eq("id", budgetId).maybeSingle();
  const status = (held as { status: string } | null)?.status;
  if (status && status !== "draft" && status !== "rejected") {
    return { ok: false, error: `This budget is ${status} — it cannot be deleted.` };
  }
  const { error } = await s.from("iwo_budgets").delete().eq("id", budgetId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_budget.deleted", entityType: "iwo_budget", entityId: budgetId });
  revalidatePath(PATH);
  // The work order list shows this BOM / budget's state (2026-09-20).
  revalidatePath("/orders/internal-work-orders");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Approval (Phase 5, 0595)
// ---------------------------------------------------------------------------

/**
 * Submit a saved budget for approval — the order Budget's `submitBudget`, the
 * IWO's way.
 *
 * REFUSED WHILE THE BOM HAS MOVED. A pulled line carries the BOM's figure as it
 * stood at the last refresh; submitting after the BOM changed would put a stale
 * weight in front of the approver. So the pull runs again here and the budget
 * is refused unless it already says what the BOM says (`mergeIwoPulled` empty)
 * — press Refresh from BOM, save, submit. A budget with no pulled line (typed
 * by hand, no BOM yet) is not held to a BOM.
 *
 * THE STATUS AND THE RUN ARE ONE STEP: a failed `startApproval` puts the
 * budget back to draft (0595 lets a client make exactly that move), because a
 * submitted budget in nobody's queue is the stranded document the engine
 * exists to prevent. Submitting LOCKS the work order's BOMs (0595).
 */
export async function submitIwoBudget(budgetId: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data: b, error } = await s
    .from("iwo_budgets")
    .select("id, iwo_id, status, location_id, iwo_budget_lines(*), iwo:internal_work_orders(code, iwo_for)")
    .eq("id", budgetId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!b) return { ok: false, error: "That budget no longer exists." };
  type Row = {
    id: string;
    iwo_id: string;
    status: string;
    location_id: string;
    iwo_budget_lines: IwoBudgetLineRow[];
    iwo: { code: string | null; iwo_for: IwoFor } | { code: string | null; iwo_for: IwoFor }[] | null;
  };
  const row = b as unknown as Row;
  const iwo = Array.isArray(row.iwo) ? row.iwo[0] : row.iwo;
  if (row.status !== "draft" && row.status !== "rejected") {
    return { ok: false, error: row.status === "submitted" ? "This budget is already with the approver." : `This budget is ${row.status}.` };
  }
  const lines = row.iwo_budget_lines;
  if (!lines.length) return { ok: false, error: "Add at least one cost line before submitting." };
  const problem = iwo ? iwoBudgetProblems(lines, iwo.iwo_for)[0] : null;
  if (problem) return { ok: false, error: problem.message };

  if (lines.some((l) => l.from_bom)) {
    const fresh = await pullIwoCostLines(row.iwo_id);
    if ("refused" in fresh) return { ok: false, error: `The BOM cannot be read for this budget — ${fresh.refused}` };
    const m = mergeIwoPulled(
      lines.map((l) => ({ ...l, key: l.id })),
      fresh.lines,
    );
    if (!iwoMergeIsEmpty(m)) {
      return {
        ok: false,
        error: "The BOM has changed since these lines were pulled. Press Refresh from BOM, save, then submit.",
      };
    }
  }

  const totals = budgetTotals(lines.map((l) => lineInputOf(l)), []);
  const cost = isRefusal(totals.cost) ? null : totals.cost;
  const bySource = Object.fromEntries(
    Object.entries(totals.costBySource).map(([k, v]) => [k, isRefusal(v) ? null : v]),
  );
  const summary = { total_cost: cost, by_source: bySource, unpriced_lines: totals.unpriced.length, lines: lines.length };

  const { error: upErr } = await s
    .from("iwo_budgets")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: (await getAppUser())?.id ?? null,
      submitted_summary: summary,
    })
    .eq("id", budgetId);
  if (upErr) return { ok: false, error: upErr.message };

  const started = await startApproval({
    workflowKey: WORKFLOWS.iwo_budget.key,
    subjectTable: WORKFLOWS.iwo_budget.subjectTable,
    subjectId: budgetId,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: { total_cost: cost, unpriced_lines: totals.unpriced.length, iwo_for: iwo?.iwo_for ?? null, iwo_code: iwo?.code ?? null },
    scope: { location_id: row.location_id },
  });
  if (!started.ok) {
    await s
      .from("iwo_budgets")
      .update({ status: "draft", submitted_at: null, submitted_by: null, submitted_summary: null })
      .eq("id", budgetId);
    return { ok: false, error: `No approval could be started — ${started.error}` };
  }

  await writeAudit({ action: "iwo_budget.submitted", entityType: "iwo_budget", entityId: budgetId });
  revalidatePath(PATH);
  // The work order list shows this BOM / budget's state (2026-09-20).
  revalidatePath("/orders/internal-work-orders");
  return { ok: true, budgetId };
}

/**
 * Reopen an APPROVED budget — approver-only, with a reason (0595's
 * `reopen_iwo_budget`, which checks both itself). Back to draft; the work
 * order's BOMs unlock.
 */
export async function reopenIwoBudget(budgetId: string, reason: string): Promise<Result> {
  if (!(await can("orders", "approve"))) return { ok: false, error: "Only an approver can reopen an approved budget." };
  const s = await createClient();
  const { error } = await s.rpc("reopen_iwo_budget", { p_budget: budgetId, p_reason: reason });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_budget.reopened", entityType: "iwo_budget", entityId: budgetId });
  revalidatePath(PATH);
  // The work order list shows this BOM / budget's state (2026-09-20).
  revalidatePath("/orders/internal-work-orders");
  return { ok: true, budgetId };
}
