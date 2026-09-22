import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BankJournal } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getBankJournals(): Promise<BankJournal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_journals")
    .select("*")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as BankJournal[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
