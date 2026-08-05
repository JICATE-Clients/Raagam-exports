import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  CapacityPlan,
  CapacityPlanOrder,
  CapacityPlanDetail,
  ProductionPlan,
  ProductionPlanOrder,
  ProductionPlanDetail,
} from "./production-planning-types";
import { withCreators } from "@/lib/created-by";

// ============================================================================
// 1. CAPACITY PLANNING
// ============================================================================

export async function listCapacityPlans(): Promise<CapacityPlan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("capacity_plans")
    .select("*")
    .order("created_at", { ascending: false });

  return withCreators((data ?? []) as CapacityPlan[]);
}

export async function getCapacityPlan(id: string) {
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("capacity_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return null;

  const header = plan as CapacityPlan;

  const { data: orders } = await supabase
    .from("capacity_plan_orders")
    .select("*")
    .eq("capacity_plan_id", id)
    .order("sno");

  const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
  let allDetails: CapacityPlanDetail[] = [];
  if (orderIds.length > 0) {
    const { data: details } = await supabase
      .from("capacity_plan_details")
      .select("*")
      .in("order_id", orderIds)
      .order("sno");
    allDetails = (details ?? []) as CapacityPlanDetail[];
  }

  return {
    ...header,
    orders: ((orders ?? []) as CapacityPlanOrder[]).map((order) => ({
      ...order,
      details: allDetails.filter((d) => d.order_id === order.id),
    })),
  };
}

// ============================================================================
// 2. PRODUCTION PLANNING
// ============================================================================

export async function listProductionPlans(): Promise<ProductionPlan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_plans")
    .select("*")
    .order("created_at", { ascending: false });

  return withCreators((data ?? []) as ProductionPlan[]);
}

export async function getProductionPlan(id: string) {
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("production_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return null;

  const header = plan as ProductionPlan;

  const { data: orders } = await supabase
    .from("production_plan_orders")
    .select("*")
    .eq("production_plan_id", id)
    .order("sno");

  const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
  let allDetails: ProductionPlanDetail[] = [];
  if (orderIds.length > 0) {
    const { data: details } = await supabase
      .from("production_plan_details")
      .select("*")
      .in("order_id", orderIds)
      .order("sno");
    allDetails = (details ?? []) as ProductionPlanDetail[];
  }

  return {
    ...header,
    orders: ((orders ?? []) as ProductionPlanOrder[]).map((order) => ({
      ...order,
      details: allDetails.filter((d) => d.order_id === order.id),
    })),
  };
}
