import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaActivity } from "./types";

export async function getTaActivities(): Promise<TaActivity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_activities")
    .select("*")
    .order("sequence")
    .order("name");
  return (data ?? []) as TaActivity[];
}
