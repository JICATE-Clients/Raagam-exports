import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Allowance } from "./allowance-types";

export async function listAllowances(): Promise<Allowance[]> {
  const s = await createClient();
  const { data } = await s
    .from("allowances")
    .select("*")
    .order("sequence")
    .order("entry_no");
  return (data ?? []) as Allowance[];
}
