"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  advisedItemInput,
  ADVISED_STATUSES,
  type AdvisedItemInput,
  type AdvisedStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/advised-items";

export async function addAdvisedItem(
  payload: AdvisedItemInput,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = advisedItemInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("order_advised_items").insert(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setAdvisedItemStatus(
  itemId: string,
  status: AdvisedStatus,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!ADVISED_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_advised_items")
    .update({ status })
    .eq("id", itemId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteAdvisedItem(itemId: string): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_advised_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
