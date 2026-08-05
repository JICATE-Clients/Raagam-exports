import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ForwardContract } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getForwardContracts(): Promise<ForwardContract[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("forward_contracts")
    .select("*")
    .order("created_at", { ascending: false });
  return withCreators((data ?? []) as ForwardContract[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
