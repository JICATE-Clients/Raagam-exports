import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PrintItem } from "./print-item-types";

export async function listPrintItems(): Promise<PrintItem[]> {
  const s = await createClient();
  const { data } = await s
    .from("print_items")
    .select("*")
    .order("code", { nullsFirst: false });
  return (data ?? []) as PrintItem[];
}
