import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { TaActivity } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getTaActivities(): Promise<TaActivity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_activities")
    .select("*, type:config_lookups(id, code, name)")
    .order("name");
  return withCreators((data ?? []) as unknown as TaActivity[]);
}

/** Type picker options — config_lookups of kind 'ta_activity_type'. */
export async function getTaActivityTypes(): Promise<ConfigLookup[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("config_lookups")
    .select("*")
    .eq("kind", "ta_activity_type")
    .order("name");
  return withCreators((data ?? []) as ConfigLookup[]);
}
