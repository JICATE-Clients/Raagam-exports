import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EpcgDeclaration } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getEpcgDeclarations(): Promise<EpcgDeclaration[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("epcg_declarations")
    .select("*")
    .order("created_at", { ascending: false });
  return withCreators((data ?? []) as EpcgDeclaration[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
