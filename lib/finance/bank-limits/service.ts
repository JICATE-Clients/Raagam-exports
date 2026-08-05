import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BankLimit } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getBankLimits(): Promise<BankLimit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_limits")
    .select("*")
    .order("bank_name");
  return withCreators((data ?? []) as BankLimit[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
