import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderGarmentProcess } from "./types";

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
