import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { GroupTiming } from "./group-timing-types";

/** Every dated revision of every group's hours, oldest first per group. */
export async function listGroupTimings(): Promise<GroupTiming[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_group_timings")
    .select("id, timing_group, in_time, out_time, grace_minutes, effective_from, created_at, created_by, updated_at")
    .order("timing_group")
    .order("effective_from", { ascending: true });
  // A failed read is an error, not "no hours set" — the two look the same on
  // screen and mean opposite things.
  if (error) console.error("[group-timings] list failed", error);
  return withCreators((data ?? []) as GroupTiming[]);
}
