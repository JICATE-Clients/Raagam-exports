import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PipelineOrder, SeasonalOrder } from "./pipeline-types";

export type PipelineOrderRow = PipelineOrder & { buyer_name: string | null };

export async function listPipelineOrders(): Promise<PipelineOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("pipeline_orders")
    .select("*, buyers:customer_id(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
    } as unknown as PipelineOrderRow;
  });
}

export async function listSeasonalOrders(): Promise<SeasonalOrder[]> {
  const s = await createClient();
  const { data } = await s
    .from("seasonal_orders")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as SeasonalOrder[];
}
