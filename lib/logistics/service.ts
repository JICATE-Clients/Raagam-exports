import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Shipment, ShipmentLine, ShipmentDocument, DocType } from "./types";

/** Shipment enriched with buyer for list / detail views. */
export type ShipmentWithBuyer = Shipment & {
  buyers: { id: string; name: string; country: string | null } | null;
};

/** Junction row with linked sales order details. */
export type ShipmentOrderRow = {
  shipment_id: string;
  sales_order_id: string;
  sales_orders: {
    id: string;
    order_number: string | null;
    buyer_id: string | null;
    currency_code: string | null;
    fob_price: number;
  } | null;
};

/** Lightweight order for the new-shipment order picker. */
export type SalesOrderForPicker = {
  id: string;
  order_number: string | null;
  buyer_id: string | null;
  currency_code: string | null;
  fob_price: number;
  status: string;
  buyers: { name: string } | null;
};

// ---------- shipment list / detail ----------

export async function listShipments(): Promise<ShipmentWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipments")
    .select("*, buyers(id, name, country)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ShipmentWithBuyer[];
}

export async function getShipment(id: string): Promise<ShipmentWithBuyer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipments")
    .select("*, buyers(id, name, country)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as ShipmentWithBuyer | null;
}

/** Linked sales orders for a shipment (with order # etc. for display). */
export async function getShipmentOrders(shipmentId: string): Promise<ShipmentOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_orders")
    .select("*, sales_orders(id, order_number, buyer_id, currency_code, fob_price)")
    .eq("shipment_id", shipmentId);
  return (data ?? []) as unknown as ShipmentOrderRow[];
}

export async function getShipmentLines(shipmentId: string): Promise<ShipmentLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_lines")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("sort_order");
  return (data ?? []) as ShipmentLine[];
}

export async function getShipmentDocuments(shipmentId: string): Promise<ShipmentDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_documents")
    .select("*")
    .eq("shipment_id", shipmentId);
  return (data ?? []) as ShipmentDocument[];
}

export async function getDocument(
  shipmentId: string,
  docType: DocType,
): Promise<ShipmentDocument | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_documents")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("doc_type", docType)
    .maybeSingle();
  return (data ?? null) as ShipmentDocument | null;
}

// ---------- form helpers ----------

export async function getBuyers(): Promise<
  { id: string; name: string; code: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export async function getCurrencies(): Promise<{ code: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name")
    .eq("is_active", true)
    .order("code");
  if (data && data.length > 0) return data;
  // Fallback when no currencies table is seeded
  return [
    { code: "USD", name: "US Dollar" },
    { code: "EUR", name: "Euro" },
    { code: "GBP", name: "British Pound" },
    { code: "INR", name: "Indian Rupee" },
  ];
}

/** Orders in confirmed / in_production status — shown in the new-shipment picker. */
export async function getOrdersForPicker(): Promise<SalesOrderForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, buyer_id, currency_code, fob_price, status, buyers(name)")
    .in("status", ["confirmed", "in_production"])
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as SalesOrderForPicker[];
}

/** so_line_items for a given set of order IDs, with order context for line prefill. */
export async function getOrderLinesForShipment(orderIds: string[]): Promise<
  {
    sales_order_id: string;
    color: string | null;
    size: string | null;
    quantity: number;
    order_number: string | null;
    fob_price: number;
  }[]
> {
  if (orderIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("so_line_items")
    .select(
      "sales_order_id, color, size, quantity, sales_orders!inner(order_number, fob_price)",
    )
    .in("sales_order_id", orderIds);

  return ((data ?? []) as unknown as Array<{
    sales_order_id: string;
    color: string | null;
    size: string | null;
    quantity: number;
    sales_orders: { order_number: string | null; fob_price: number } | null;
  }>).map((r) => ({
    sales_order_id: r.sales_order_id,
    color: r.color,
    size: r.size,
    quantity: r.quantity,
    order_number: r.sales_orders?.order_number ?? null,
    fob_price: r.sales_orders?.fob_price ?? 0,
  }));
}
