"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  budgetInput,
  budgetPurchaseInput,
  budgetProcessInput,
  budgetProcessItemInput,
  budgetCmtInput,
  budgetCmtOperationInput,
  budgetOtherEntryInput,
  budgetHeadInput,
  budgetStyleInput,
} from "./budget-types";
import type {
  BudgetInput,
  BudgetPurchaseInput,
  BudgetProcessInput,
  BudgetProcessItemInput,
  BudgetCmtInput,
  BudgetCmtOperationInput,
  BudgetOtherEntryInput,
  BudgetHeadInput,
  BudgetStyleInput,
} from "./budget-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidateBudget(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/budgets");
}

// ============================================================================
// Budget Header CRUD
// ============================================================================

export async function createBudget(
  data: BudgetInput,
): Promise<{ ok: true; budgetId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = budgetInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: budget, error } = await supabase
    .from("budgets")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !budget) return { ok: false, error: error?.message ?? "Failed" };

  revalidateBudget();
  return { ok: true, budgetId: budget.id };
}

export async function updateBudget(
  id: string,
  data: BudgetInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${id}`);
  return { ok: true };
}

export async function submitBudget(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${id}`);
  return { ok: true };
}

export async function approveBudget(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("budgets")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "budget.approved",
    entityType: "budget",
    entityId: id,
  });

  revalidateBudget(`/planning/budgets/${id}`);
  return { ok: true };
}

export async function rejectBudget(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${id}`);
  return { ok: true };
}

// ============================================================================
// Budget Purchases (Tab 1 — Purchase Rates)
// ============================================================================

export async function addBudgetPurchase(
  data: BudgetPurchaseInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetPurchaseInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_purchases")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetPurchase(
  itemId: string,
  budgetId: string,
  data: BudgetPurchaseInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetPurchaseInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_purchases")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetPurchase(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_purchases")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget Processes (Tab 2 — Process Rates)
// ============================================================================

export async function addBudgetProcess(
  data: BudgetProcessInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetProcessInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_processes")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetProcess(
  itemId: string,
  budgetId: string,
  data: BudgetProcessInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetProcessInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_processes")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetProcess(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete child items first
  await supabase
    .from("budget_process_items")
    .delete()
    .eq("process_id", itemId);
  const { error } = await supabase
    .from("budget_processes")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget Process Items (child of budget_processes)
// ============================================================================

export async function addBudgetProcessItem(
  data: BudgetProcessItemInput,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetProcessItemInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_process_items")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function updateBudgetProcessItem(
  itemId: string,
  budgetId: string,
  data: BudgetProcessItemInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetProcessItemInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { process_id: _pid, ...updateData } = parsed.data;
  void _pid;
  const { error } = await supabase
    .from("budget_process_items")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetProcessItem(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_process_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget CMTs (Tab 3)
// ============================================================================

export async function addBudgetCmt(
  data: BudgetCmtInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetCmtInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_cmts")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetCmt(
  itemId: string,
  budgetId: string,
  data: BudgetCmtInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetCmtInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_cmts")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetCmt(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete child operations first
  await supabase
    .from("budget_cmt_operations")
    .delete()
    .eq("cmt_id", itemId);
  const { error } = await supabase
    .from("budget_cmts")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget CMT Operations (child of budget_cmts)
// ============================================================================

export async function addBudgetCmtOperation(
  data: BudgetCmtOperationInput,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetCmtOperationInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_cmt_operations")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function updateBudgetCmtOperation(
  itemId: string,
  budgetId: string,
  data: BudgetCmtOperationInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetCmtOperationInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { cmt_id: _cid, ...updateData } = parsed.data;
  void _cid;
  const { error } = await supabase
    .from("budget_cmt_operations")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetCmtOperation(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_cmt_operations")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget Other Entries (Tab 4 & 5 — Expenses / Incomes)
// ============================================================================

export async function addBudgetOtherEntry(
  data: BudgetOtherEntryInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetOtherEntryInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_other_entries")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetOtherEntry(
  itemId: string,
  budgetId: string,
  data: BudgetOtherEntryInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetOtherEntryInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_other_entries")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetOtherEntry(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_other_entries")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget Heads (Tab 6 — General)
// ============================================================================

export async function addBudgetHead(
  data: BudgetHeadInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetHeadInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_heads")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetHead(
  itemId: string,
  budgetId: string,
  data: BudgetHeadInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetHeadInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_heads")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetHead(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_heads")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

// ============================================================================
// Budget Styles (Tab 6 — General)
// ============================================================================

export async function addBudgetStyle(
  data: BudgetStyleInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetStyleInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_styles")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${data.budget_id}`);
  return { ok: true };
}

export async function updateBudgetStyle(
  itemId: string,
  budgetId: string,
  data: BudgetStyleInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetStyleInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { budget_id: _bid, ...updateData } = parsed.data;
  void _bid;
  const { error } = await supabase
    .from("budget_styles")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}

export async function deleteBudgetStyle(
  itemId: string,
  budgetId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_styles")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBudget(`/planning/budgets/${budgetId}`);
  return { ok: true };
}
