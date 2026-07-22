import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderPackRatio, ExcessOrder } from "./pack-ratio-types";

export type PackRatioRow = OrderPackRatio & { order_code: string | null };

export async function listPackRatios(salesOrderId?: string): Promise<PackRatioRow[]> {
  const s = await createClient();
  let q = s.from("order_pack_ratios").select("*, sales_orders(order_number)").order("created_at", { ascending: false });
  if (salesOrderId) q = q.eq("sales_order_id", salesOrderId);
  const { data } = await q;
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null } as unknown as PackRatioRow;
  });
}

export type ExcessOrderRow = ExcessOrder & { order_code: string | null };

export async function listExcessOrders(): Promise<ExcessOrderRow[]> {
  const s = await createClient();
  const { data } = await s.from("excess_orders").select("*, sales_orders(order_number)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null } as unknown as ExcessOrderRow;
  });
}
