import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { MerchandisingTeam } from "./merchandising-team-types";

export async function listMerchandisingTeams(): Promise<MerchandisingTeam[]> {
  const s = await createClient();
  const { data } = await s
    .from("merchandising_teams")
    .select("*, location:locations(id,name)")
    .order("name");
  return withCreators((data ?? []) as unknown as MerchandisingTeam[]);
}
