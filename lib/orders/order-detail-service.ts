import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderCoordinateColor, OrderDescription, OrderTrim, OrderFabric, OrderApprovalParam } from "./order-detail-types";

export async function getOrderCoordinateColors(salesOrderId: string): Promise<OrderCoordinateColor[]> {
  const s = await createClient();
  const { data } = await s.from("order_coordinate_colors").select("*").eq("sales_order_id", salesOrderId).order("sno");
  return (data ?? []) as OrderCoordinateColor[];
}

export async function getOrderDescriptions(salesOrderId: string): Promise<OrderDescription[]> {
  const s = await createClient();
  const { data } = await s.from("order_descriptions").select("*").eq("sales_order_id", salesOrderId).order("sno");
  return (data ?? []) as OrderDescription[];
}

export async function getOrderTrims(salesOrderId: string): Promise<OrderTrim[]> {
  const s = await createClient();
  const { data } = await s.from("order_trims").select("*").eq("sales_order_id", salesOrderId).order("sno");
  return (data ?? []) as OrderTrim[];
}

export async function getOrderFabrics(salesOrderId: string): Promise<OrderFabric[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_fabrics")
    .select("*, order_fabric_components(*)")
    .eq("sales_order_id", salesOrderId)
    .order("sno");
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      components: [...((row.order_fabric_components ?? []) as OrderFabric["components"])].sort((a, b) => a.sno - b.sno),
    } as unknown as OrderFabric;
  });
}

export async function getOrderApprovalParams(salesOrderId: string): Promise<OrderApprovalParam[]> {
  const s = await createClient();
  const { data } = await s.from("order_approval_params").select("*").eq("sales_order_id", salesOrderId).order("sno");
  return (data ?? []) as OrderApprovalParam[];
}
