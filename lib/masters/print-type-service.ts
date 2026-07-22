import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PrintType } from "./print-type-types";

export async function listPrintTypes(): Promise<PrintType[]> {
  const s = await createClient();
  const { data } = await s
    .from("print_types")
    .select("*")
    .order("code", { nullsFirst: false });
  return (data ?? []) as PrintType[];
}
