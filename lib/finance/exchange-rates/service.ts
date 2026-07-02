import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExchangeRateDetail } from "./types";

export async function getExchangeRates(): Promise<ExchangeRateDetail[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exchange_rate_details")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as ExchangeRateDetail[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
