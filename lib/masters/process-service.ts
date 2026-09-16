import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Process } from "./process-types";

export async function listProcesses(): Promise<Process[]> {
  const s = await createClient();
  // `fabric_stages` is 0563's `process_fabric_stages` — a BARE embed, which is
  // only answerable while that table has exactly ONE foreign key to `processes`.
  // The day it gains a second, name the column (`process_fabric_stages!process_id`)
  // or PostgREST answers PGRST201 for every row in this master (AGENTS.md, "A
  // second FK breaks every existing embed").
  const { data, error } = await s
    .from("processes")
    .select("*, sub_categories:process_sub_categories(*), fabric_stages:process_fabric_stages(*)")
    .order("name", { nullsFirst: false });
  // A RETRY THAT DROPPED THE EMBED LIVED HERE ON 2026-09-16, for the window
  // between 0563 being written and applied, and came out the same day once it
  // was. It is recorded because the reason it went generalises: a read that
  // quietly re-issues itself without a missing piece hands back a result that
  // looks whole, and here that means every process reading as UNCLASSIFIED —
  // which `stage-routes.ts` treats as "allowed in every stage", silently
  // switching the ledger rule off. Throwing names the absent table instead.
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md). This used to read
  // `data ?? []`, which was survivable while the select was `*` over one table
  // and an embed that has existed since 0227. It is not survivable now: an
  // unapplied 0563 makes the whole select fail, and "the Process master is
  // empty" is a real and unremarkable answer that gets believed rather than
  // reported — the same trap `getFabricProcessRows` records one module over.
  if (error) throw new Error(`Could not load the Process master: ${error.message}`);
  return withCreators(((data ?? []) as Process[]).map((p) => ({
    ...p,
    sub_categories: [...(p.sub_categories ?? [])].sort((x, y) => x.sno - y.sno),
    fabric_stages: p.fabric_stages ?? [],
  })));
}
