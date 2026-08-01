import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { WorkingHour } from "./working-hour-types";

export async function listWorkingHours(): Promise<WorkingHour[]> {
  const s = await createClient();
  const { data } = await s.from("working_hours").select("*").order("entry_no", { ascending: false });
  return withCreators((data ?? []) as WorkingHour[]);
}
