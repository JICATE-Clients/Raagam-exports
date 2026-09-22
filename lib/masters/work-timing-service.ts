import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkTiming } from "./work-timing-types";
import { withCreators } from "@/lib/created-by";

export async function listWorkTimings(): Promise<WorkTiming[]> {
  const s = await createClient();
  const { data } = await s
    .from("work_timings")
    .select("*, location:locations(id,name), lines:work_timing_lines(*)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("entry_no", { ascending: true });
  return withCreators(((data ?? []) as unknown as WorkTiming[]).map((w) => ({
    ...w,
    lines: [...(w.lines ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}
