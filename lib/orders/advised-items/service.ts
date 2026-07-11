import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderAdvisedItem } from "./types";
import type { OrderWithBuyer } from "@/lib/orders/service";

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

/** Advised items for one order (per-order editor). */
export async function getAdvisedItemsByOrder(
  orderId: string,
): Promise<OrderAdvisedItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_advised_items")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("sort_order")
    .order("created_at");
  return (data ?? []) as OrderAdvisedItem[];
}

/** An accepted order plus its count of already-prepared advised items. */
export type AdvisedOrderRow = OrderWithBuyer & { item_count: number };

const ACCEPTED_STATUSES = ["confirmed", "in_production"] as const;

/**
 * Accepted orders for the "Prepare Advised Items — By SC No" selector.
 * `order_number` doubles as SC No / Order No, `buyers.country` as CountryID.
 * Optional filters narrow to one customer (buyer) or one order.
 */
export async function getAcceptedOrdersWithAdvisedCount(filters?: {
  buyerId?: string;
  orderId?: string;
}): Promise<AdvisedOrderRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("sales_orders")
    .select("*, buyers(id, name, country), order_advised_items(count)")
    .in("status", ACCEPTED_STATUSES as readonly string[]);

  if (filters?.buyerId) query = query.eq("buyer_id", filters.buyerId);
  if (filters?.orderId) query = query.eq("id", filters.orderId);

  const { data } = await query.order("created_at", { ascending: false });

  return ((data ?? []) as unknown as (OrderWithBuyer & {
    order_advised_items: { count: number }[];
  })[]).map((o) => ({
    ...o,
    item_count: o.order_advised_items?.[0]?.count ?? 0,
  }));
}
