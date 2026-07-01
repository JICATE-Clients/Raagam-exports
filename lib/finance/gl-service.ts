import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GlAccount, JournalEntry, JournalLine } from "./types";

// ---------- derived types ----------

export type GlAccountForPicker = { id: string; code: string; name: string; account_type: string };
export type LocationForPicker = { id: string; code: string; name: string };

export type JournalWithLines = JournalEntry & {
  lines: JournalLine[];
};

// ---------- accounts ----------

export async function listAccounts(): Promise<GlAccount[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gl_accounts")
    .select("*")
    .order("code");
  return (data ?? []) as GlAccount[];
}

export async function getAccountsForPicker(): Promise<GlAccountForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gl_accounts")
    .select("id, code, name, account_type")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as GlAccountForPicker[];
}

// ---------- journals ----------

export async function listJournals(): Promise<JournalEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  return (data ?? []) as JournalEntry[];
}

export async function getJournal(id: string): Promise<JournalWithLines | null> {
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!entry) return null;

  const { data: lines } = await supabase
    .from("journal_lines")
    .select("*")
    .eq("journal_entry_id", id)
    .order("sort_order");

  return {
    ...(entry as JournalEntry),
    lines: (lines ?? []) as JournalLine[],
  };
}

// ---------- shared pickers ----------

export async function getLocationsForPicker(): Promise<LocationForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationForPicker[];
}
