"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrDeactivate } from "@/lib/masters/delete-guard";
import {
  groupInput,
  centreInput,
  type GroupInput,
  type CentreInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
/** Wider than `ActionResult`: a guarded delete may have DEACTIVATED instead, and
 *  the screen can only say so if the verdict travels back with the result. */
type DeleteResult =
  | { ok: true; inactive: boolean; usedBy?: string }
  | { ok: false; error: string };

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

export async function deleteGroup(id: string): Promise<DeleteResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  // A group its cost centres still point at is soft-disabled, never deleted —
  // hard-deleting it would strip those centres of their grouping.
  const res = await deleteOrDeactivate(supabase, "cost_centre_groups", id, "is_active");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
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

export async function deleteCentre(id: string): Promise<DeleteResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  // A centre already charged against is soft-disabled, never deleted — the
  // postings that name it must keep meaning something.
  const res = await deleteOrDeactivate(supabase, "cost_centres", id, "is_active");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
