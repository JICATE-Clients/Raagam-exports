import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AdvanceLoanType } from "./advance-loan-type-types";

export async function listAdvanceLoanTypes(): Promise<AdvanceLoanType[]> {
  const s = await createClient();
  const { data } = await s.from("advance_loan_types").select("*").order("short_name");
  return (data ?? []) as AdvanceLoanType[];
}
