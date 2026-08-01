import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Country } from "./country-types";

export async function listCountries(): Promise<Country[]> {
  const s = await createClient();
  const { data } = await s.from("countries").select("*").order("name");
  return withCreators((data ?? []) as Country[]);
}
