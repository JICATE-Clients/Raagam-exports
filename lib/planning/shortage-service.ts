import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MaterialShortage } from "./types";

export type { OrderForPicker } from "./budget-service";
export { getOrdersForPicker } from "./budget-service";

export type ItemOption = { id: string; code: string | null; name: string };
export type UomOption = { id: string; code: string; name: string };

/** A shortage row joined with its order number and item name for display. */
export interface ShortageWithRefs extends MaterialShortage {
  order_number: string | null;
  item_name: string | null;
}

export async function listShortages(): Promise<ShortageWithRefs[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_shortages")
    .select("*, sales_orders(order_number), items(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const so = row.sales_orders as Record<string, unknown> | null;
    const item = row.items as Record<string, unknown> | null;
    return {
      ...(row as unknown as MaterialShortage),
      order_number: (so?.order_number as string | null) ?? null,
      item_name: (item?.name as string | null) ?? null,
    };
  });
}

export async function getItems(): Promise<ItemOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name")
    .order("name");
  return (data ?? []) as ItemOption[];
}

export async function getUoms(): Promise<UomOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name")
    .order("code");
  return (data ?? []) as UomOption[];
}
