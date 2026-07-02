"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { exchangeRateInput, type ExchangeRateInput } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/finance/exchange-rates";

export async function createExchangeRate(
  payload: ExchangeRateInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = exchangeRateInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("exchange_rate_details").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteExchangeRate(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("exchange_rate_details").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
