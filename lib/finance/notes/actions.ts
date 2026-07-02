"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  financeNoteInput,
  NOTE_STATUSES,
  type FinanceNoteInput,
  type NoteStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/finance/notes";

export async function createFinanceNote(
  payload: FinanceNoteInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");

  const parsed = financeNoteInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Null out the party that doesn't match party_type.
  const data = {
    ...parsed.data,
    vendor_id: parsed.data.party_type === "vendor" ? parsed.data.vendor_id : null,
    buyer_id: parsed.data.party_type === "buyer" ? parsed.data.buyer_id : null,
  };

  const supabase = await createClient();
  const { error } = await supabase.from("finance_notes").insert(data);
  if (error) return { ok: false, error: error.message };

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setFinanceNoteStatus(
  id: string,
  status: NoteStatus,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  if (!NOTE_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_notes")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteFinanceNote(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("finance_notes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
