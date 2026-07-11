import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderGarmentProcess } from "./types";
import type { OrderWithBuyer } from "@/lib/orders/service";

export async function getOrderProcesses(
  orderId: string,
): Promise<OrderGarmentProcess[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_garment_processes")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("sequence");
  return (data ?? []) as OrderGarmentProcess[];
}

/** An accepted order plus its count of already-defined garment processes. */
export type AcceptedOrderRow = OrderWithBuyer & { process_count: number };

/** Statuses treated as "accepted" — live orders whose processes can be defined. */
const ACCEPTED_STATUSES = ["confirmed", "in_production"] as const;

/**
 * Accepted orders for the "Define Garment Processes" selector. Reproduces the
 * legacy "By SC No" grid: `order_number` doubles as SC No / Order No, `created_at`
 * as SC/Order date, `ship_date` as delivery date. Optional filters narrow to one
 * order or a single status.
 */
export async function getAcceptedOrders(filters?: {
  orderId?: string;
  status?: string;
}): Promise<AcceptedOrderRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("sales_orders")
    .select("*, buyers(id, name, country), order_garment_processes(count)");

  if (filters?.status && (ACCEPTED_STATUSES as readonly string[]).includes(filters.status)) {
    query = query.eq("status", filters.status);
  } else {
    query = query.in("status", ACCEPTED_STATUSES as readonly string[]);
  }

  if (filters?.orderId) query = query.eq("id", filters.orderId);

  const { data } = await query.order("created_at", { ascending: false });

  return ((data ?? []) as unknown as (OrderWithBuyer & {
    order_garment_processes: { count: number }[];
  })[]).map((o) => ({
    ...o,
    process_count: o.order_garment_processes?.[0]?.count ?? 0,
  }));
}
