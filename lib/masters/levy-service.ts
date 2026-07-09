import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Levy } from "./levy-types";

export async function listLevies(): Promise<Levy[]> {
  const s = await createClient();
  const { data } = await s.from("levies").select("*").order("entry_no");
  return (data ?? []) as Levy[];
}
