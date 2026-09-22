import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
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
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("entry_no", { ascending: true });
  return withCreators(((data ?? []) as ExchangeRateEntry[]).map((e) => ({
    ...e,
    lines: [...(e.lines ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}
