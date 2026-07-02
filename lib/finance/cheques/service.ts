import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Cheque } from "./types";

export async function getCheques(): Promise<Cheque[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cheques")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Cheque[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
