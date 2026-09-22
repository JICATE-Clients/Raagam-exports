import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderPackRatio, ExcessOrder } from "./pack-ratio-types";
import { withCreators } from "@/lib/created-by";

export type PackRatioRow = OrderPackRatio & { order_code: string | null };

export async function listPackRatios(salesOrderId?: string): Promise<PackRatioRow[]> {
  const s = await createClient();
  // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
  let q = s.from("order_pack_ratios").select("*, sales_orders(order_number)").order("created_at", { ascending: true });
  if (salesOrderId) q = q.eq("sales_order_id", salesOrderId);
  const { data } = await q;
  return withCreators(((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null } as unknown as PackRatioRow;
  }));
}

export type ExcessOrderRow = ExcessOrder & { order_code: string | null };

export async function listExcessOrders(): Promise<ExcessOrderRow[]> {
  const s = await createClient();
  // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
  const { data } = await s.from("excess_orders").select("*, sales_orders(order_number)").order("created_at", { ascending: true });
  return withCreators(((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null } as unknown as ExcessOrderRow;
  }));
}
