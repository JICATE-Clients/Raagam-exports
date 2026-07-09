import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkingHour } from "./working-hour-types";

export async function listWorkingHours(): Promise<WorkingHour[]> {
  const s = await createClient();
  const { data } = await s.from("working_hours").select("*").order("entry_no", { ascending: false });
  return (data ?? []) as WorkingHour[];
}
