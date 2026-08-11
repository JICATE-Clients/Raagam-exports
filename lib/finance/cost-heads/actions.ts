"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrDeactivate } from "@/lib/masters/delete-guard";
import {
  costHeadInput,
  costItemInput,
  type CostHeadInput,
  type CostItemInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
/** Wider than `ActionResult`: a guarded delete may have DEACTIVATED instead, and
 *  the screen can only say so if the verdict travels back with the result. */
type DeleteResult =
  | { ok: true; inactive: boolean; usedBy?: string }
  | { ok: false; error: string };

const PATH = "/finance/cost-heads";

// ---------- cost heads ----------

export async function createCostHead(payload: CostHeadInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = costHeadInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cost_heads").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleCostHead(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_heads").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCostHead(id: string): Promise<DeleteResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  // A head its cost items still hang off is soft-disabled, never deleted.
  const res = await deleteOrDeactivate(supabase, "cost_heads", id, "is_active");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

// ---------- cost items ----------

export async function createCostItem(payload: CostItemInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = costItemInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cost_items").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleCostItem(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_items").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCostItem(id: string): Promise<DeleteResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  // An item already costed against is soft-disabled, never deleted.
  const res = await deleteOrDeactivate(supabase, "cost_items", id, "is_active");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
