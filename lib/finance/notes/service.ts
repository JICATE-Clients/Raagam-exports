import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FinanceNote } from "./types";
import { withCreators } from "@/lib/created-by";

export type FinanceNoteRow = FinanceNote & {
  vendors: { id: string; name: string } | null;
  buyers: { id: string; name: string } | null;
};

export type PartyOption = { id: string; name: string };

export async function getFinanceNotes(): Promise<FinanceNoteRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("finance_notes")
    .select("*, vendors(id, name), buyers(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as unknown as FinanceNoteRow[]);
}

export async function getVendorOptions(): Promise<PartyOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name")
    .order("name");
  return (data ?? []) as PartyOption[];
}

export async function getBuyerOptions(): Promise<PartyOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PartyOption[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
