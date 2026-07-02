"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  packingAdviceInput,
  packingLineInput,
  PLA_STATUSES,
  type PackingAdviceInput,
  type PackingLineInput,
  type PlaStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; adviceId: string } | { ok: false; error: string };

const LIST_PATH = "/orders/packing-advice";

export async function createPackingAdvice(
  payload: PackingAdviceInput,
): Promise<CreateResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = packingAdviceInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packing_advices")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create packing advice" };
  }

  await writeAudit({
    action: "packing_advice.created",
    entityType: "packing_advice",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, adviceId: data.id };
}

export async function addPackingLine(
  adviceId: string,
  data: PackingLineInput,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = packingLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_advice_lines")
    .insert({ ...parsed.data, advice_id: adviceId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${adviceId}`);
  return { ok: true };
}

export async function deletePackingLine(
  lineId: string,
  adviceId: string,
): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_advice_lines")
    .delete()
    .eq("id", lineId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${adviceId}`);
  return { ok: true };
}

export async function setPackingAdviceStatus(
  adviceId: string,
  status: PlaStatus,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!PLA_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_advices")
    .update({ status })
    .eq("id", adviceId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${adviceId}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}
