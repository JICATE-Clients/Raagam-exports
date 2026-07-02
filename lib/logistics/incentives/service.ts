import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExportIncentiveFile } from "./types";

export async function getIncentiveFiles(): Promise<ExportIncentiveFile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("export_incentive_files")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as ExportIncentiveFile[];
}

export { getCurrencyOptions } from "@/lib/logistics/proforma/service";
