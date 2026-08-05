import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExportIncentiveFile } from "./types";
import { withCreators } from "@/lib/created-by";

export async function getIncentiveFiles(): Promise<ExportIncentiveFile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("export_incentive_files")
    .select("*")
    .order("created_at", { ascending: false });
  return withCreators((data ?? []) as ExportIncentiveFile[]);
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
