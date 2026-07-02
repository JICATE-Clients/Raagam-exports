"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { epcgInput, EPCG_STATUSES, type EpcgInput, type EpcgStatus } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/logistics/epcg";

export async function createEpcg(payload: EpcgInput): Promise<ActionResult> {
  if (!(await can("logistics", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = epcgInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("epcg_declarations").insert(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setEpcgStatus(
  id: string,
  status: EpcgStatus,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!EPCG_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("epcg_declarations")
    .update({ status })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteEpcg(id: string): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("epcg_declarations").delete().eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
