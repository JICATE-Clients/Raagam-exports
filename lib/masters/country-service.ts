import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Country } from "./country-types";

export async function listCountries(): Promise<Country[]> {
  const s = await createClient();
  const { data } = await s.from("countries").select("*").order("name");
  return (data ?? []) as Country[];
}
