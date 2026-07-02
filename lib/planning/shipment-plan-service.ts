import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ShipmentPlan } from "./types";

export type { OrderForPicker } from "./budget-service";
export { getOrdersForPicker } from "./budget-service";

export type BuyerOption = { id: string; name: string };

/** A plan row with buyer name + covered-order count for the list view. */
export interface ShipmentPlanWithMeta extends ShipmentPlan {
  buyer_name: string | null;
  order_count: number;
}

/** A covered order joined with its number/buyer for the detail view. */
export interface PlanOrderRow {
  sales_order_id: string;
  planned_qty: number;
  order_number: string | null;
  buyer_name: string | null;
  order_qty: number;
}

export async function listShipmentPlans(): Promise<ShipmentPlanWithMeta[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_plans")
    .select("*, buyers(name), shipment_plan_orders(sales_order_id)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const buyer = row.buyers as Record<string, unknown> | null;
    const orders = (row.shipment_plan_orders ?? []) as unknown[];
    return {
      ...(row as unknown as ShipmentPlan),
      buyer_name: (buyer?.name as string | null) ?? null,
      order_count: orders.length,
    };
  });
}

export async function getShipmentPlan(id: string): Promise<ShipmentPlan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as ShipmentPlan | null;
}

export async function getPlanOrders(planId: string): Promise<PlanOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_plan_orders")
    .select("sales_order_id, planned_qty, sales_orders(order_number, order_qty, buyers(name))")
    .eq("shipment_plan_id", planId);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const so = row.sales_orders as Record<string, unknown> | null;
    const buyer = so?.buyers as Record<string, unknown> | null;
    return {
      sales_order_id: row.sales_order_id as string,
      planned_qty: (row.planned_qty as number) ?? 0,
      order_number: (so?.order_number as string | null) ?? null,
      buyer_name: (buyer?.name as string | null) ?? null,
      order_qty: (so?.order_qty as number) ?? 0,
    };
  });
}

export async function getBuyers(): Promise<BuyerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("buyers").select("id, name").order("name");
  return (data ?? []) as BuyerOption[];
}
