"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { taActivityInput, type TaActivityInput } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const PATH = "/orders/ta-masters";

export async function createTaActivity(
  payload: TaActivityInput,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = taActivityInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ta_activities").insert(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateTaActivity(
  id: string,
  payload: TaActivityInput,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = taActivityInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ta_activities")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleTaActivity(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ta_activities")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteTaActivity(id: string): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ta_activities").delete().eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}
