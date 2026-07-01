"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { budgetInput, budgetLineInput, lineAmount } from "./types";
import type { BudgetInput, BudgetLineInput } from "./types";
import { getBomSourceLines } from "./budget-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; budgetId: string } | ErrResult;

function revalidateBudget(budgetId: string): void {
  revalidatePath(`/planning/budgets/${budgetId}`);
  revalidatePath("/planning/budgets");
  revalidatePath("/planning");
}

// ---------- recalc total ----------

export async function recalcBudgetTotal(budgetId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from("budget_lines")
    .select("amount")
    .eq("budget_id", budgetId);

  const total = ((lines ?? []) as { amount: number }[]).reduce(
    (sum, l) => sum + (l.amount ?? 0),
    0,
  );

  const { error } = await supabase
    .from("budgets")
    .update({ total_amount: total })
    .eq("id", budgetId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- create budget ----------

export async function createBudget(payload: BudgetInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = budgetInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { sales_order_ids, ...budgetFields } = parsed.data;

  if (!budgetFields.is_grouped && sales_order_ids.length !== 1) {
    return { ok: false, error: "Single-order budget must reference exactly one order" };
  }
  if (budgetFields.is_grouped && sales_order_ids.length < 1) {
    return { ok: false, error: "Grouped budget requires at least one order" };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: budget, error } = await supabase
    .from("budgets")
    .insert({
      ...budgetFields,
      status: "draft",
      total_amount: 0,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !budget) {
    return { ok: false, error: error?.message ?? "Failed to create budget" };
  }

  const { error: boErr } = await supabase.from("budget_orders").insert(
    sales_order_ids.map((soId) => ({ budget_id: budget.id, sales_order_id: soId })),
  );
  if (boErr) {
    console.error("[planning/budget] budget_orders insert error:", boErr.message);
  }

  revalidateBudget(budget.id);
  return { ok: true, budgetId: budget.id };
}

// ---------- add budget line ----------

export async function addBudgetLine(
  budgetId: string,
  data: BudgetLineInput,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { quantity, unit_cost, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_cost);

  const supabase = await createClient();
  const { error } = await supabase.from("budget_lines").insert({
    ...rest,
    budget_id: budgetId,
    quantity,
    unit_cost,
    amount,
  });

  if (error) return { ok: false, error: error.message };

  await recalcBudgetTotal(budgetId);
  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- update budget line ----------

export async function updateBudgetLine(
  lineId: string,
  budgetId: string,
  data: BudgetLineInput,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = budgetLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { quantity, unit_cost, ...rest } = parsed.data;
  const amount = lineAmount(quantity, unit_cost);

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_lines")
    .update({ ...rest, quantity, unit_cost, amount })
    .eq("id", lineId);

  if (error) return { ok: false, error: error.message };

  await recalcBudgetTotal(budgetId);
  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- delete budget line ----------

export async function deleteBudgetLine(
  lineId: string,
  budgetId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase.from("budget_lines").delete().eq("id", lineId);

  if (error) return { ok: false, error: error.message };

  await recalcBudgetTotal(budgetId);
  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- pull from BOMs ----------

export async function pullFromBoms(budgetId: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: budgetOrders } = await supabase
    .from("budget_orders")
    .select("sales_order_id")
    .eq("budget_id", budgetId);

  const orderIds = ((budgetOrders ?? []) as { sales_order_id: string }[]).map(
    (bo) => bo.sales_order_id,
  );

  if (orderIds.length === 0) {
    return { ok: false, error: "Budget has no covered orders" };
  }

  const sourceLines = await getBomSourceLines(orderIds);

  if (sourceLines.length === 0) {
    return { ok: false, error: "No BOM data found for the covered orders" };
  }

  const { error } = await supabase.from("budget_lines").insert(
    sourceLines.map((line) => ({ ...line, budget_id: budgetId })),
  );

  if (error) return { ok: false, error: error.message };

  await recalcBudgetTotal(budgetId);
  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- submit ----------

export async function submitBudget(budgetId: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: budget } = await supabase
    .from("budgets")
    .select("status")
    .eq("id", budgetId)
    .maybeSingle();

  if (!budget || budget.status !== "draft") {
    return { ok: false, error: "Budget is not in draft status" };
  }

  const { error } = await supabase
    .from("budgets")
    .update({ status: "submitted" })
    .eq("id", budgetId);

  if (error) return { ok: false, error: error.message };

  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- approve ----------

export async function approveBudget(budgetId: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: budget } = await supabase
    .from("budgets")
    .select("status")
    .eq("id", budgetId)
    .maybeSingle();

  if (!budget || budget.status !== "submitted") {
    return { ok: false, error: "Budget is not in submitted status" };
  }

  // recompute total before approving to ensure accuracy
  const { data: lines } = await supabase
    .from("budget_lines")
    .select("amount")
    .eq("budget_id", budgetId);

  const total = ((lines ?? []) as { amount: number }[]).reduce(
    (sum, l) => sum + (l.amount ?? 0),
    0,
  );

  const { error } = await supabase
    .from("budgets")
    .update({
      status: "approved",
      total_amount: total,
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", budgetId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "budget.approved",
    entityType: "budget",
    entityId: budgetId,
    metadata: { total_amount: total },
  });

  // TODO downstream to Purchase module: raise purchase requisition from approved budget lines

  revalidateBudget(budgetId);
  return { ok: true };
}

// ---------- reject ----------

export async function rejectBudget(budgetId: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: budget } = await supabase
    .from("budgets")
    .select("status")
    .eq("id", budgetId)
    .maybeSingle();

  if (!budget || budget.status !== "submitted") {
    return { ok: false, error: "Budget is not in submitted status" };
  }

  const { error } = await supabase
    .from("budgets")
    .update({ status: "rejected" })
    .eq("id", budgetId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "budget.rejected",
    entityType: "budget",
    entityId: budgetId,
  });

  revalidateBudget(budgetId);
  return { ok: true };
}
