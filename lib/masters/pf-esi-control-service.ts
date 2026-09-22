import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { PfEsiControl } from "./pf-esi-control-types";

/** All PF/ESI control revisions, newest entry first. */
export async function listPfEsiControls(): Promise<PfEsiControl[]> {
  const s = await createClient();
  const { data } = await s
    .from("pf_esi_controls")
    .select("*")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("entry_no", { ascending: true });
  return withCreators((data ?? []) as PfEsiControl[]);
}
