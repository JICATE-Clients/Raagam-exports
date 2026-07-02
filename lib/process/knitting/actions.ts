"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  knittingProgramInput,
  KP_STATUSES,
  type KnittingProgramInput,
  type KpStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/process/knitting";

export async function createKnittingProgram(
  payload: KnittingProgramInput,
): Promise<ActionResult> {
  if (!(await can("process_planning", "create"))) throw new Error("Forbidden");
  const parsed = knittingProgramInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("knitting_programs").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setKnittingProgramStatus(
  id: string,
  status: KpStatus,
): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");
  if (!KP_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("knitting_programs")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteKnittingProgram(id: string): Promise<ActionResult> {
  if (!(await can("process_planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("knitting_programs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
