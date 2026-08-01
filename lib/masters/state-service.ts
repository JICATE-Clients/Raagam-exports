import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { State } from "./state-types";

export async function listStates(): Promise<State[]> {
  const s = await createClient();
  const { data } = await s.from("states").select("*").order("name");
  return withCreators((data ?? []) as State[]);
}
