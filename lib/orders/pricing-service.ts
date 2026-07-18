import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderPrice, PriceConfirmation, PcPurchaseItem, PcProcess, PcCmtOperation } from "./pricing-types";

export async function getOrderPrices(salesOrderId: string): Promise<OrderPrice[]> {
  const s = await createClient();
  const { data } = await s.from("order_prices").select("*").eq("sales_order_id", salesOrderId).order("sno");
  return (data ?? []) as OrderPrice[];
}

export type PriceConfirmationRow = PriceConfirmation & { order_code: string | null };

export async function listPriceConfirmations(): Promise<PriceConfirmationRow[]> {
  const s = await createClient();
  const { data } = await s.from("price_confirmations").select("*, sales_orders(code)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, order_code: (row.sales_orders as { code: string } | null)?.code ?? null } as unknown as PriceConfirmationRow;
  });
}

export async function getPcPurchaseItems(priceConfId: string): Promise<PcPurchaseItem[]> {
  const s = await createClient();
  const { data } = await s.from("pc_purchase_items").select("*").eq("price_conf_id", priceConfId).order("item_class_type").order("sno");
  return (data ?? []) as PcPurchaseItem[];
}

export async function getPcProcesses(priceConfId: string): Promise<PcProcess[]> {
  const s = await createClient();
  const { data } = await s.from("pc_processes").select("*").eq("price_conf_id", priceConfId).order("process_type").order("sno");
  return (data ?? []) as PcProcess[];
}

export async function getPcCmtOperations(priceConfId: string): Promise<PcCmtOperation[]> {
  const s = await createClient();
  const { data } = await s.from("pc_cmt_operations").select("*").eq("price_conf_id", priceConfId).order("sno");
  return (data ?? []) as PcCmtOperation[];
}
