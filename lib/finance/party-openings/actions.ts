"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { partyOpeningInput, type PartyOpeningInput } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/finance/party-openings";

export async function createPartyOpening(
  payload: PartyOpeningInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = partyOpeningInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = {
    ...parsed.data,
    vendor_id: parsed.data.party_type === "vendor" ? parsed.data.vendor_id : null,
    buyer_id: parsed.data.party_type === "buyer" ? parsed.data.buyer_id : null,
  };
  const supabase = await createClient();
  const { error } = await supabase.from("party_openings").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deletePartyOpening(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("party_openings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
