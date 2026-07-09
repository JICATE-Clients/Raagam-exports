import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Process } from "./process-types";

export async function listProcesses(): Promise<Process[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("*, sub_categories:process_sub_categories(*)")
    .order("name", { nullsFirst: false });
  return ((data ?? []) as Process[]).map((p) => ({
    ...p,
    sub_categories: [...(p.sub_categories ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
