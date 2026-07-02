import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BankLimit } from "./types";

export async function getBankLimits(): Promise<BankLimit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_limits")
    .select("*")
    .order("bank_name");
  return (data ?? []) as BankLimit[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
