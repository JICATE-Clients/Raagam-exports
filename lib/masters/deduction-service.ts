import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Deduction } from "./deduction-types";

export async function listDeductions(): Promise<Deduction[]> {
  const s = await createClient();
  const { data } = await s
    .from("deductions")
    .select("*")
    .order("sequence")
    .order("entry_no");
  return withCreators((data ?? []) as Deduction[]);
}
