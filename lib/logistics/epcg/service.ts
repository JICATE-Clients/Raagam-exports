import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EpcgDeclaration } from "./types";

export async function getEpcgDeclarations(): Promise<EpcgDeclaration[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("epcg_declarations")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as EpcgDeclaration[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
