import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderAdvisedItem } from "./types";

export type AdvisedItemWithOrder = OrderAdvisedItem & {
  sales_orders: {
    id: string;
    order_number: string | null;
    buyers: { name: string } | null;
  } | null;
};

export async function getAdvisedItems(): Promise<AdvisedItemWithOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_advised_items")
    .select("*, sales_orders(id, order_number, buyers(name))")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as AdvisedItemWithOrder[];
}
