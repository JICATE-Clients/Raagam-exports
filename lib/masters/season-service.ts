import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Season } from "./season-types";

export async function listSeasons(): Promise<Season[]> {
  const s = await createClient();
  const { data } = await s
    .from("seasons")
    .select("*")
    .order("season_name", { nullsFirst: false });
  return (data ?? []) as Season[];
}
