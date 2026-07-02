import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PackingAdvice, PackingAdviceLine } from "./types";

type OrderRef = {
  id: string;
  order_number: string | null;
  buyers: { name: string } | null;
};

export type PackingAdviceWithOrder = PackingAdvice & {
  sales_orders: OrderRef | null;
};

export async function getPackingAdvices(): Promise<PackingAdviceWithOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("packing_advices")
    .select("*, sales_orders(id, order_number, buyers(name))")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as PackingAdviceWithOrder[];
}

export async function getPackingAdvice(
  id: string,
): Promise<PackingAdviceWithOrder | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("packing_advices")
    .select("*, sales_orders(id, order_number, buyers(name))")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as PackingAdviceWithOrder | null;
}

export async function getPackingAdviceLines(
  adviceId: string,
): Promise<PackingAdviceLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("packing_advice_lines")
    .select("*")
    .eq("advice_id", adviceId)
    .order("sort_order");
  return (data ?? []) as PackingAdviceLine[];
}
