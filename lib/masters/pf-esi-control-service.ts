import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PfEsiControl } from "./pf-esi-control-types";

/** All PF/ESI control revisions, newest entry first. */
export async function listPfEsiControls(): Promise<PfEsiControl[]> {
  const s = await createClient();
  const { data } = await s
    .from("pf_esi_controls")
    .select("*")
    .order("entry_no", { ascending: false });
  return (data ?? []) as PfEsiControl[];
}
