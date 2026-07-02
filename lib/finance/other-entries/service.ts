import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OtherEntry } from "./types";

export async function getOtherEntries(): Promise<OtherEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("other_income_expenses")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as OtherEntry[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
