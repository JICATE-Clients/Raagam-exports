import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ForwardContract } from "./types";

export async function getForwardContracts(): Promise<ForwardContract[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("forward_contracts")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as ForwardContract[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
