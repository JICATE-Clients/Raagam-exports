import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PipelineOrder, SeasonalOrder } from "./pipeline-types";
import { withCreators } from "@/lib/created-by";

export type PipelineOrderRow = PipelineOrder & { buyer_name: string | null };

export async function listPipelineOrders(): Promise<PipelineOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("pipeline_orders")
    .select("*, buyers:customer_id(name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
    } as unknown as PipelineOrderRow;
  }));
}

export type SeasonalOrderRow = SeasonalOrder & { vendor_name: string | null };

export async function listSeasonalOrders(): Promise<SeasonalOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("seasonal_orders")
    .select("*, vendors:vendor_id(name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      vendor_name: (row.vendors as { name: string } | null)?.name ?? null,
    } as unknown as SeasonalOrderRow;
  }));
}
