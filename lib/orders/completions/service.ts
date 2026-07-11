import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderCompletion } from "./types";

/** A selectable order for the SC No picker (carries buyer for auto-fill). */
export type OrderOption = {
  id: string;
  order_number: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  status: string;
};

/** A buyer for the Customer picker. */
export type BuyerOption = { id: string; code: string | null; name: string };

export type CompletionRow = OrderCompletion & {
  sales_orders: {
    order_number: string | null;
    buyers: { name: string } | null;
  } | null;
};

/** Past completions (newest first) with order + buyer context. */
export async function getCompletions(): Promise<CompletionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_completions")
    .select("*, sales_orders(order_number, buyers(name))")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as CompletionRow[];
}

/** Orders that can still be completed (not cancelled and not already closed). */
export async function getCompletableOrders(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, status, buyer_id, buyers(name)")
    .not("status", "in", "(cancelled,closed)")
    .order("created_at", { ascending: false });

  return (
    (data ?? []) as unknown as {
      id: string;
      order_number: string | null;
      status: string;
      buyer_id: string | null;
      buyers: { name: string } | null;
    }[]
  ).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    buyer_id: o.buyer_id,
    buyer_name: o.buyers?.name ?? null,
    status: o.status,
  }));
}

/** Buyers for the Customer picker. */
export async function getBuyerOptions(): Promise<BuyerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as BuyerOption[];
}
