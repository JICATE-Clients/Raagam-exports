import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// HSN Assign to Processes (GST). A bulk-edit grid over the existing `processes`
// master (the sub-contract Process master): list every process + its HSN, plus
// read-only identity / commodity / status columns for filtering. No own table —
// a lean read + a one-column bulk update. Mirrors the HSN-to-Materials /
// TCS / GST-assign patterns. Replaces the legacy "HSN Assign to Process — By
// Process" 2-step wizard.
//
// NOTE: `processes.hsn_code` is a plain TEXT column (not an FK like
// `items.hsn_id`), so we store the chosen HSN code string directly. Processes
// have no item class — they carry `commodity_id`, which we surface instead of
// the legacy (empty-for-us) "Itemclass Name" column. No migration.
// ============================================================================

export interface ProcessHsnRow {
  id: string;
  name: string; // legacy "Process Name"
  hsn_code: string | null; // TEXT — the HSN code we assign
  commodity_id: string | null; // config_lookups 'commodity' (replaces item class)
  inactive: boolean; // Status = Inactive when true
}

export async function listProcessHsn(): Promise<ProcessHsnRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, hsn_code, commodity_id, inactive")
    .order("name");
  return (data ?? []) as ProcessHsnRow[];
}
