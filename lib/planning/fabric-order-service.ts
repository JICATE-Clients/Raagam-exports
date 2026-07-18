import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FabricOrder, DomesticProductionPlan } from "./fabric-order-types";

export type FabricOrderRow = FabricOrder & { buyer_name: string | null; order_code: string | null };

export async function listFabricOrders(): Promise<FabricOrderRow[]> {
  const s = await createClient();
  const { data } = await s.from("fabric_orders").select("*, buyers:customer_id(name), sales_orders(code)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, buyer_name: (row.buyers as { name: string } | null)?.name ?? null, order_code: (row.sales_orders as { code: string } | null)?.code ?? null } as unknown as FabricOrderRow;
  });
}

export type DomesticProdPlanRow = DomesticProductionPlan & { buyer_name: string | null };

export async function listDomesticProdPlans(): Promise<DomesticProdPlanRow[]> {
  const s = await createClient();
  const { data } = await s.from("domestic_production_plans").select("*, buyers:customer_id(name)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, buyer_name: (row.buyers as { name: string } | null)?.name ?? null } as unknown as DomesticProdPlanRow;
  });
}
