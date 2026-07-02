import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FinanceNote } from "./types";

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
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as FinanceNoteRow[];
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
