import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PackingFormatColumn } from "./packing-format-columns-types";

// Client-safe type + DEFAULT_COLUMNS now live in packing-format-columns-types.ts
// so client components can import them without pulling in this server-only module.
export type { PackingFormatColumn } from "./packing-format-columns-types";
export { DEFAULT_COLUMNS } from "./packing-format-columns-types";

export async function listPackingFormatColumns(formatId: string): Promise<PackingFormatColumn[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_list_format_columns")
    .select("*")
    .eq("packing_list_format_id", formatId)
    .order("display_order");
  return (data ?? []) as PackingFormatColumn[];
}
