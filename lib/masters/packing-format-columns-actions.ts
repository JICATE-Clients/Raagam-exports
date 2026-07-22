"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { DEFAULT_COLUMNS } from "./packing-format-columns-service";

type Result = { ok: true } | { ok: false; error: string };

type ColumnInput = {
  column_key: string;
  display_name: string;
  display_order: number;
  is_visible: boolean;
};

export async function savePackingFormatColumns(
  formatId: string,
  columns: ColumnInput[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return { ok: false, error: "Forbidden" };
  if (!formatId) return { ok: false, error: "Format ID is required" };

  const s = await createClient();

  // Delete existing and re-insert
  await s.from("packing_list_format_columns").delete().eq("packing_list_format_id", formatId);

  if (columns.length > 0) {
    const rows = columns.map((c, i) => ({
      packing_list_format_id: formatId,
      column_key: c.column_key,
      display_name: c.display_name,
      display_order: i + 1,
      is_visible: c.is_visible,
    }));
    const { error } = await s.from("packing_list_format_columns").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/masters");
  return { ok: true };
}

export async function initPackingFormatColumns(formatId: string): Promise<Result> {
  if (!(await can("masters", "edit"))) return { ok: false, error: "Forbidden" };
  if (!formatId) return { ok: false, error: "Format ID is required" };

  const s = await createClient();

  // Check if already initialized
  const { count } = await s
    .from("packing_list_format_columns")
    .select("id", { count: "exact", head: true })
    .eq("packing_list_format_id", formatId);

  if ((count ?? 0) > 0) return { ok: true }; // Already has columns

  const rows = DEFAULT_COLUMNS.map((c) => ({
    packing_list_format_id: formatId,
    ...c,
  }));
  const { error } = await s.from("packing_list_format_columns").insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/masters");
  return { ok: true };
}
