import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BankJournal } from "./types";

export async function getBankJournals(): Promise<BankJournal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_journals")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as BankJournal[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
