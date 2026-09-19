"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import { pullIwoCostLines } from "./service";
import type { IwoPullResult } from "./pull";
import { iwoBudgetInput, type IwoBudgetInput } from "./types";
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
  return { ok: true };
}
