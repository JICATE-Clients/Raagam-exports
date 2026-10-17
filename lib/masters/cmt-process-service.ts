import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { CmtProcess } from "./cmt-process-types";

export async function listCmtProcesses(): Promise<CmtProcess[]> {
  const s = await createClient();
  const { data, error } = await s.from("cmt_processes").select("*").order("created_at");
  if (error) throw new Error(`Could not load CMT processes: ${error.message}`);
  return withCreators(
    ((data ?? []) as (CmtProcess & { standard_rate: number | string | null })[]).map((r) => ({
      ...r,
      standard_rate: r.standard_rate == null ? null : Number(r.standard_rate),
    })),
  );
}
