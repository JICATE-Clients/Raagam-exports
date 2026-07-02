"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  costHeadInput,
  costItemInput,
  type CostHeadInput,
  type CostItemInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

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

export async function deleteCostHead(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_heads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
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

export async function deleteCostItem(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
