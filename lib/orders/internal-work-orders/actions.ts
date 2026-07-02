"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  iwoInput,
  iwoLineInput,
  IWO_STATUSES,
  type IwoInput,
  type IwoLineInput,
  type IwoStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; iwoId: string } | { ok: false; error: string };

const LIST_PATH = "/orders/internal-work-orders";

// ---------- create IWO ----------

export async function createInternalWorkOrder(
  payload: IwoInput,
): Promise<CreateResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = iwoInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("internal_work_orders")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create work order" };
  }

  await writeAudit({
    action: "internal_work_order.created",
    entityType: "internal_work_order",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, iwoId: data.id };
}

// ---------- add / remove lines ----------

export async function addIwoLine(
  iwoId: string,
  data: IwoLineInput,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = iwoLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("iwo_lines")
    .insert({ ...parsed.data, iwo_id: iwoId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${iwoId}`);
  return { ok: true };
}

export async function deleteIwoLine(
  lineId: string,
  iwoId: string,
): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("iwo_lines").delete().eq("id", lineId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${iwoId}`);
  return { ok: true };
}

// ---------- status transitions ----------

export async function setIwoStatus(
  iwoId: string,
  status: IwoStatus,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!IWO_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "issued") patch.issued_at = new Date().toISOString();

  const { error } = await supabase
    .from("internal_work_orders")
    .update(patch)
    .eq("id", iwoId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: `internal_work_order.${status}`,
    entityType: "internal_work_order",
    entityId: iwoId,
  });

  revalidatePath(`${LIST_PATH}/${iwoId}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}
