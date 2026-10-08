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
