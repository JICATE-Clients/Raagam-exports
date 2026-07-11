import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaCompletion } from "./types";

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

export type TaCompletionRow = TaCompletion & {
  sales_orders: {
    order_number: string | null;
    buyers: { name: string } | null;
  } | null;
};

/** Past TA completions (newest first) with order + buyer context. */
export async function getTaCompletions(): Promise<TaCompletionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_completions")
    .select("*, sales_orders(order_number, buyers(name))")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as TaCompletionRow[];
}

/** Orders eligible for a TA completion (anything not cancelled). */
export async function getTaCompletableOrders(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, status, buyer_id, buyers(name)")
    .neq("status", "cancelled")
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
