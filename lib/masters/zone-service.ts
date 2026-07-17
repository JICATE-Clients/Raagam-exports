import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Zone } from "./zone-types";

export async function listZones(): Promise<Zone[]> {
  const s = await createClient();
  const { data } = await s
    .from("zones")
    .select("*, areas:zone_areas(id, area_name)")
    .order("zone_name", { nullsFirst: false });
  return (data ?? []) as Zone[];
}
