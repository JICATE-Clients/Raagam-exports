"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { budgetAmendmentInput, bomAmendmentInput } from "./types";
import type { BudgetAmendmentInput, BomAmendmentInput } from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

// ============================================================================
// Budget amendments
// ============================================================================

function revalidateBudgetAmendments(): void {
  revalidatePath("/planning/budget-amendments");
  revalidatePath("/planning");
}

export async function raiseBudgetAmendment(
  payload: BudgetAmendmentInput,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = budgetAmendmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: budget } = await supabase
    .from("budgets")
    .select("status, total_amount")
    .eq("id", parsed.data.budget_id)
    .maybeSingle();

  if (!budget) return { ok: false, error: "Budget not found" };
  if (budget.status !== "approved") {
    return { ok: false, error: "Only an approved budget can be amended" };
  }

  const user = await getAppUser();
  const { error } = await supabase.from("budget_amendments").insert({
    budget_id: parsed.data.budget_id,
    previous_total: budget.total_amount ?? 0,
    revised_total: parsed.data.revised_total,
    reason: parsed.data.reason,
    status: "draft",
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, error: error.message };
  revalidateBudgetAmendments();
  return { ok: true };
}

export async function submitBudgetAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("budget_amendments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "draft") {
    return { ok: false, error: "Amendment is not in draft status" };
  }
  const { error } = await supabase
    .from("budget_amendments")
    .update({ status: "submitted" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateBudgetAmendments();
  return { ok: true };
}

export async function approveBudgetAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("budget_amendments")
    .select("status, budget_id, revised_total")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Amendment is not in submitted status" };
  }

  const { error } = await supabase
    .from("budget_amendments")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // apply the revised total to the parent budget
  const { error: budErr } = await supabase
    .from("budgets")
    .update({ total_amount: row.revised_total })
    .eq("id", row.budget_id as string);
  if (budErr) return { ok: false, error: budErr.message };

  await writeAudit({
    action: "budget_amendment.approved",
    entityType: "budget_amendment",
    entityId: id,
    metadata: { budget_id: row.budget_id, revised_total: row.revised_total },
  });

  revalidateBudgetAmendments();
  revalidatePath(`/planning/budgets/${row.budget_id as string}`);
  return { ok: true };
}

export async function rejectBudgetAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("budget_amendments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Amendment is not in submitted status" };
  }
  const { error } = await supabase
    .from("budget_amendments")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    action: "budget_amendment.rejected",
    entityType: "budget_amendment",
    entityId: id,
  });
  revalidateBudgetAmendments();
  return { ok: true };
}

// ============================================================================
// BOM amendments
// ============================================================================

function revalidateBomAmendments(): void {
  revalidatePath("/planning/bom-amendments");
  revalidatePath("/planning");
}

export async function raiseBomAmendment(
  payload: BomAmendmentInput,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = bomAmendmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { bom_kind, fabric_bom_id, material_bom_id } = parsed.data;
  // enforce the same target rule the DB check enforces, with a friendly message
  if (bom_kind === "fabric" && !fabric_bom_id) {
    return { ok: false, error: "Select a fabric BOM" };
  }
  if (bom_kind === "material" && !material_bom_id) {
    return { ok: false, error: "Select a material BOM" };
  }

  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase.from("bom_amendments").insert({
    bom_kind,
    fabric_bom_id: bom_kind === "fabric" ? fabric_bom_id : null,
    material_bom_id: bom_kind === "material" ? material_bom_id : null,
    sales_order_id: parsed.data.sales_order_id ?? null,
    change_summary: parsed.data.change_summary,
    reason: parsed.data.reason ?? null,
    status: "draft",
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, error: error.message };
  revalidateBomAmendments();
  return { ok: true };
}

export async function submitBomAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("bom_amendments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "draft") {
    return { ok: false, error: "Amendment is not in draft status" };
  }
  const { error } = await supabase
    .from("bom_amendments")
    .update({ status: "submitted" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateBomAmendments();
  return { ok: true };
}

export async function approveBomAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("bom_amendments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Amendment is not in submitted status" };
  }
  const { error } = await supabase
    .from("bom_amendments")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    action: "bom_amendment.approved",
    entityType: "bom_amendment",
    entityId: id,
  });
  revalidateBomAmendments();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// BOM Amendment Lines (per-line transfer qty/wt editing)
// ---------------------------------------------------------------------------

export async function addBomAmendmentLine(
  amendmentId: string,
  data: { item_description?: string | null; uom_id?: string | null; original_qty?: number; original_wt?: number; transfer_qty?: number; transfer_wt?: number; transfer_qty_with_loss?: number; transfer_wt_with_loss?: number; notes?: string | null },
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: existing } = await supabase.from("bom_amendment_lines").select("sno").eq("amendment_id", amendmentId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { error } = await supabase.from("bom_amendment_lines").insert({ amendment_id: amendmentId, sno, ...data });
  if (error) return { ok: false, error: error.message };
  revalidateBomAmendments();
  return { ok: true };
}

export async function deleteBomAmendmentLine(id: string): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("bom_amendment_lines").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateBomAmendments();
  return { ok: true };
}

export async function rejectBomAmendment(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("bom_amendments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Amendment is not in submitted status" };
  }
  const { error } = await supabase
    .from("bom_amendments")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    action: "bom_amendment.rejected",
    entityType: "bom_amendment",
    entityId: id,
  });
  revalidateBomAmendments();
  return { ok: true };
}
