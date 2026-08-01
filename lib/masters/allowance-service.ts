import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Allowance } from "./allowance-types";

export async function listAllowances(): Promise<Allowance[]> {
  const s = await createClient();
  const { data } = await s
    .from("allowances")
    .select("*")
    .order("sequence")
    .order("entry_no");
  return withCreators((data ?? []) as Allowance[]);
}
