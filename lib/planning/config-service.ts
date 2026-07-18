import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ColorPrintDetail, ColorPrintDetailLine, MaterialRateEntry, MaterialRateItem, GeneralStockGroup } from "./config-types";

export type ColorPrintDetailRow = ColorPrintDetail;

export async function listColorPrintDetails(): Promise<ColorPrintDetailRow[]> {
  const s = await createClient();
  const { data } = await s.from("color_print_details").select("*").order("created_at", { ascending: false });
  return (data ?? []) as ColorPrintDetailRow[];
}

export async function getColorPrintLines(colorPrintId: string): Promise<ColorPrintDetailLine[]> {
  const s = await createClient();
  const { data } = await s.from("color_print_detail_lines").select("*").eq("color_print_id", colorPrintId).order("sno");
  return (data ?? []) as ColorPrintDetailLine[];
}

export type MaterialRateRow = MaterialRateEntry & { buyer_name: string | null };

export async function listMaterialRates(): Promise<MaterialRateRow[]> {
  const s = await createClient();
  const { data } = await s.from("material_rate_entries").select("*, buyers:customer_id(name)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, buyer_name: (row.buyers as { name: string } | null)?.name ?? null } as unknown as MaterialRateRow;
  });
}

export async function getMaterialRateItems(rateEntryId: string): Promise<MaterialRateItem[]> {
  const s = await createClient();
  const { data } = await s.from("material_rate_items").select("*").eq("rate_entry_id", rateEntryId).order("sno");
  return (data ?? []) as MaterialRateItem[];
}

export async function listGeneralStockGroups(): Promise<GeneralStockGroup[]> {
  const s = await createClient();
  const { data } = await s.from("general_stock_groups").select("*").order("created_at", { ascending: false });
  return (data ?? []) as GeneralStockGroup[];
}
