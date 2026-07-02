"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { lcInput, LC_STATUSES, type LcInput, type LcStatus } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; lcId: string } | { ok: false; error: string };

const LIST_PATH = "/logistics/lc";

export async function createLc(payload: LcInput): Promise<CreateResult> {
  if (!(await can("logistics", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = lcInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lc_details")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create LC" };
  }

  await writeAudit({
    action: "lc_detail.created",
    entityType: "lc_detail",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, lcId: data.id };
}

export async function updateLc(
  id: string,
  payload: LcInput,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = lcInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("lc_details")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setLcStatus(
  id: string,
  status: LcStatus,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!LC_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("lc_details")
    .update({ status })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteLc(id: string): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("lc_details").delete().eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
