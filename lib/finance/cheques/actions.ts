"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { chequeInput, CHEQUE_STATUSES, type ChequeInput, type ChequeStatus } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/finance/cheques";

export async function createCheque(payload: ChequeInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = chequeInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cheques").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setChequeStatus(
  id: string,
  status: ChequeStatus,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  if (!CHEQUE_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createClient();
  // stamp cleared_date when moving to cleared
  const patch: Record<string, unknown> = { status };
  if (status === "cleared") patch.cleared_date = new Date().toISOString().split("T")[0];
  const { error } = await supabase.from("cheques").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteCheque(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("cheques").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
