import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkTiming } from "./work-timing-types";
import { withCreators } from "@/lib/created-by";

export async function listWorkTimings(): Promise<WorkTiming[]> {
  const s = await createClient();
  const { data } = await s
    .from("work_timings")
    .select("*, location:locations(id,name), lines:work_timing_lines(*)")
    .order("entry_no", { ascending: false });
  return withCreators(((data ?? []) as unknown as WorkTiming[]).map((w) => ({
    ...w,
    lines: [...(w.lines ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}
