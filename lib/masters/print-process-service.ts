import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PrintProcess } from "./print-process-types";

export async function listPrintProcesses(): Promise<PrintProcess[]> {
  const s = await createClient();
  const { data } = await s
    .from("print_processes")
    .select("*")
    .order("code", { nullsFirst: false });
  return (data ?? []) as PrintProcess[];
}
