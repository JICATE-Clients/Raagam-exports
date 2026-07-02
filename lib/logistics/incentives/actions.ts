"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  incentiveInput,
  INCENTIVE_STATUSES,
  type IncentiveInput,
  type IncentiveStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/logistics/incentives";

export async function createIncentive(payload: IncentiveInput): Promise<ActionResult> {
  if (!(await can("logistics", "create"))) throw new Error("Forbidden");
  const parsed = incentiveInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("export_incentive_files").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setIncentiveStatus(
  id: string,
  status: IncentiveStatus,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) throw new Error("Forbidden");
  if (!INCENTIVE_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("export_incentive_files")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteIncentive(id: string): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("export_incentive_files").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
