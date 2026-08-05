import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OtherEntry } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getOtherEntries(): Promise<OtherEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("other_income_expenses")
    .select("*")
    .order("created_at", { ascending: false });
  return withCreators((data ?? []) as OtherEntry[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
