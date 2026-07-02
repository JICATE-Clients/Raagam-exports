import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InternalWorkOrder, IwoLine } from "./types";

type OrderRef = { id: string; order_number: string | null; buyers: { name: string } | null };
type LocationRef = { id: string; code: string; name: string };

export type IwoWithOrder = InternalWorkOrder & {
  sales_orders: OrderRef | null;
};

export type IwoDetail = InternalWorkOrder & {
  sales_orders: OrderRef | null;
  locations: LocationRef | null;
};

export async function getInternalWorkOrders(): Promise<IwoWithOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_work_orders")
    .select("*, sales_orders(id, order_number, buyers(name))")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as IwoWithOrder[];
}

export async function getInternalWorkOrder(id: string): Promise<IwoDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_work_orders")
    .select(
      "*, sales_orders(id, order_number, buyers(name)), locations(id, code, name)",
    )
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as IwoDetail | null;
}

export async function getIwoLines(iwoId: string): Promise<IwoLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("iwo_lines")
    .select("*")
    .eq("iwo_id", iwoId)
    .order("sort_order");
  return (data ?? []) as IwoLine[];
}
