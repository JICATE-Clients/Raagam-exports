"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  groupInput,
  centreInput,
  type GroupInput,
  type CentreInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const PATH = "/finance/cost-centres";

// ---------- groups ----------

export async function createGroup(payload: GroupInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = groupInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cost_centre_groups").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleGroup(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_centre_groups")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_centre_groups").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

// ---------- centres ----------

export async function createCentre(payload: CentreInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = centreInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cost_centres").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleCentre(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_centres")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCentre(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_centres").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
