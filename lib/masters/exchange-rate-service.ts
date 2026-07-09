import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExchangeRateEntry, ExchangeRateRegister } from "./exchange-rate-types";

/** All entries (with their rate lines) for one register, newest first. */
export async function listExchangeRateEntries(
  register: ExchangeRateRegister,
): Promise<ExchangeRateEntry[]> {
  const s = await createClient();
  const { data } = await s
    .from("exchange_rate_entries")
    .select("*, lines:exchange_rate_lines(id, sno, currency_code, ex_rate)")
    .eq("register", register)
    .order("entry_no", { ascending: false });
  return ((data ?? []) as ExchangeRateEntry[]).map((e) => ({
    ...e,
    lines: [...(e.lines ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
