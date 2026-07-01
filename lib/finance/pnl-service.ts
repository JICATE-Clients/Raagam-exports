import "server-only";
import { createClient } from "@/lib/supabase/server";
import { shipmentPnl, money } from "@/lib/finance/calc";
import type { ShipmentCost } from "@/lib/finance/types";
import type { ShipmentPnl } from "@/lib/finance/calc";

export type ShipmentRow = {
  id: string;
  code: string | null;
  buyer_id: string | null;
  total_value: number;
  status: string;
  currency_code: string | null;
  buyers: { name: string } | null;
};

export type ShipmentPnlRow = {
  shipment: ShipmentRow;
  revenue: number;
  costs: ShipmentCost[];
  pnl: ShipmentPnl;
};

// ---------- list (3 queries, not N+3) ----------

export async function listShipmentPnl(): Promise<ShipmentPnlRow[]> {
  const supabase = await createClient();

  const [{ data: shipments }, { data: allReceivables }, { data: allCosts }] =
    await Promise.all([
      supabase
        .from("shipments")
        .select("id, code, buyer_id, total_value, status, currency_code, buyers(name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("receivables")
        .select("shipment_id, amount_inr, status")
        .neq("status", "cancelled"),
      supabase.from("shipment_costs").select("*"),
    ]);

  // Aggregate receivable amounts per shipment (non-cancelled)
  const revByShipment = new Map<string, number>();
  for (const r of (allReceivables ?? []) as {
    shipment_id: string | null;
    amount_inr: number;
  }[]) {
    if (!r.shipment_id) continue;
    revByShipment.set(
      r.shipment_id,
      (revByShipment.get(r.shipment_id) ?? 0) + r.amount_inr,
    );
  }

  // Group costs per shipment
  const costsByShipment = new Map<string, ShipmentCost[]>();
  for (const c of (allCosts ?? []) as ShipmentCost[]) {
    const list = costsByShipment.get(c.shipment_id) ?? [];
    list.push(c);
    costsByShipment.set(c.shipment_id, list);
  }

  return ((shipments ?? []) as unknown as ShipmentRow[]).map((s) => {
    const rawRev = revByShipment.get(s.id);
    // Use receivable amount_inr when invoiced; else fall back to shipment total_value (FOB baseline)
    const revenue = rawRev != null ? money(rawRev) : s.total_value;
    const costs = costsByShipment.get(s.id) ?? [];
    return { shipment: s, revenue, costs, pnl: shipmentPnl(revenue, costs) };
  });
}

// ---------- detail ----------

export async function getShipmentPnl(
  shipmentId: string,
): Promise<ShipmentPnlRow | null> {
  const supabase = await createClient();

  const [{ data: shipment }, { data: receivables }, { data: costs }] =
    await Promise.all([
      supabase
        .from("shipments")
        .select("id, code, buyer_id, total_value, status, currency_code, buyers(name)")
        .eq("id", shipmentId)
        .single(),
      supabase
        .from("receivables")
        .select("amount_inr, status")
        .eq("shipment_id", shipmentId)
        .neq("status", "cancelled"),
      supabase
        .from("shipment_costs")
        .select("*")
        .eq("shipment_id", shipmentId)
        .order("created_at"),
    ]);

  if (!shipment) return null;

  const s = shipment as unknown as ShipmentRow;
  const costRows = (costs ?? []) as ShipmentCost[];

  const rawRev =
    (receivables ?? []).length > 0
      ? money(
          (receivables as { amount_inr: number }[]).reduce(
            (sum, r) => sum + r.amount_inr,
            0,
          ),
        )
      : null;
  const revenue = rawRev ?? s.total_value;

  return { shipment: s, revenue, costs: costRows, pnl: shipmentPnl(revenue, costRows) };
}

export async function getShipmentCosts(shipmentId: string): Promise<ShipmentCost[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_costs")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at");
  return (data ?? []) as ShipmentCost[];
}

/** Walk shipment_orders → budget_orders → purchase_orders; sum approved PO totals. */
export async function computeMaterialsRollup(
  shipmentId: string,
): Promise<{ total: number; poCount: number }> {
  const supabase = await createClient();

  // Step 1: linked sales order IDs
  const { data: soLinks } = await supabase
    .from("shipment_orders")
    .select("sales_order_id")
    .eq("shipment_id", shipmentId);

  const soIds = (soLinks ?? []).map(
    (r) => (r as { sales_order_id: string }).sales_order_id,
  );
  if (soIds.length === 0) return { total: 0, poCount: 0 };

  // Step 2: budget IDs via budget_orders
  const { data: budgetLinks } = await supabase
    .from("budget_orders")
    .select("budget_id")
    .in("sales_order_id", soIds);

  const budgetIds = [
    ...new Set(
      (budgetLinks ?? []).map((r) => (r as { budget_id: string }).budget_id),
    ),
  ];
  if (budgetIds.length === 0) return { total: 0, poCount: 0 };

  // Step 3: purchase orders in approved / received statuses
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, total_amount")
    .in("budget_id", budgetIds)
    .in("status", ["approved", "partially_received", "received"]);

  const poRows = (pos ?? []) as { id: string; total_amount: number }[];
  return {
    total: money(poRows.reduce((s, p) => s + p.total_amount, 0)),
    poCount: poRows.length,
  };
}
