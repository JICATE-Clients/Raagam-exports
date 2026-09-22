import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { WorkingHour } from "./working-hour-types";

export async function listWorkingHours(): Promise<WorkingHour[]> {
  const s = await createClient();
  // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
  const { data } = await s.from("working_hours").select("*").order("entry_no", { ascending: true });
  return withCreators((data ?? []) as WorkingHour[]);
}
