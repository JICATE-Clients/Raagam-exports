"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  categoryInput,
  assignmentInput,
  type CategoryInput,
  type AssignmentInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const CAT_PATH = "/logistics/export-categories";
const ASSIGN_PATH = "/logistics/order-categories";

// ---------- categories ----------

export async function createCategory(payload: CategoryInput): Promise<ActionResult> {
  if (!(await can("logistics", "create"))) throw new Error("Forbidden");
  const parsed = categoryInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("export_categories").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(CAT_PATH);
  return { ok: true };
}

export async function updateCategory(
  id: string,
  payload: CategoryInput,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) throw new Error("Forbidden");
  const parsed = categoryInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("export_categories")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(CAT_PATH);
  return { ok: true };
}

export async function toggleCategory(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("export_categories")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(CAT_PATH);
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("export_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(CAT_PATH);
  return { ok: true };
}

// ---------- order category assignments ----------

export async function assignCategory(payload: AssignmentInput): Promise<ActionResult> {
  if (!(await can("logistics", "create"))) throw new Error("Forbidden");
  const parsed = assignmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("order_category_assignments")
    .insert(parsed.data);
  if (error) {
    // 23505 = unique_violation (order already has that category)
    if (error.code === "23505") {
      return { ok: false, error: "That category is already assigned to this order." };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath(ASSIGN_PATH);
  return { ok: true };
}

export async function unassignCategory(id: string): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("order_category_assignments")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(ASSIGN_PATH);
  return { ok: true };
}
