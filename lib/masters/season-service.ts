import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Season } from "./season-types";

/** Every season, in ENTRY order (AGENTS.md "Listings in ENTRY order"). A
 *  FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. */
export async function listSeasons(): Promise<Season[]> {
  const s = await createClient();
  const { data, error } = await s.from("seasons").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load seasons: ${error.message}`);
  return withCreators((data ?? []) as Season[]);
}

/** THE SEASON BOX'S LIST (0717) — the master's names, switched-off rows left
 *  out, in entry order (Q1–Q4, then SUMMER / WINTER / SPRING / AUTUMN). Order
 *  Entry, the Style master and the Season report all read this; a held value
 *  the list no longer has survives through `seasonChoice`. */
export async function listSeasonNames(): Promise<string[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("seasons")
    .select("season, season_name")
    .eq("inactive", false)
    .order("created_at", { ascending: true })
    .order("season_name", { ascending: true });
  if (error) throw new Error(`Could not load seasons: ${error.message}`);
  return [
    ...new Set(
      ((data ?? []) as { season: string; season_name: string | null }[])
        .map((r) => (r.season_name?.trim() || r.season).toUpperCase())
        .filter(Boolean),
    ),
  ];
}
