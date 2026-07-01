import "server-only";
import { createClient } from "@/lib/supabase/server";
import { netConsumption, effectiveMaterialQty, lineAmount } from "./types";
import type { Budget, BudgetLine } from "./types";
import type { Currency } from "@/lib/masters/types";

export type { Currency };

export type OrderForPicker = {
  id: string;
  order_number: string | null;
  buyer_name: string | null;
  order_qty: number;
};

export type BudgetOrderRow = {
  budget_id: string;
  sales_order_id: string;
  order_number: string | null;
  buyer_name: string | null;
  order_qty: number;
};

/** Pre-computed line ready for insertion into budget_lines (sans budget_id). */
export type BomSourceLine = {
  sales_order_id: string;
  source: "fabric" | "material";
  description: string;
  quantity: number;
  unit_cost: number;
  amount: number;
  sort_order: number;
};

export async function listBudgets(): Promise<Budget[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Budget[];
}

export async function getBudget(id: string): Promise<Budget | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as Budget | null;
}

export async function getBudgetOrders(budgetId: string): Promise<BudgetOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_orders")
    .select(
      "budget_id, sales_order_id, sales_orders!inner(order_number, order_qty, buyers(name))",
    )
    .eq("budget_id", budgetId);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const so = row.sales_orders as Record<string, unknown> | null;
    const buyer = so?.buyers as Record<string, unknown> | null;
    return {
      budget_id: row.budget_id as string,
      sales_order_id: row.sales_order_id as string,
      order_number: (so?.order_number as string | null) ?? null,
      buyer_name: (buyer?.name as string | null) ?? null,
      order_qty: (so?.order_qty as number) ?? 0,
    };
  });
}

export async function getBudgetLines(budgetId: string): Promise<BudgetLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_lines")
    .select("*")
    .eq("budget_id", budgetId)
    .order("sort_order");
  return (data ?? []) as BudgetLine[];
}

export async function getCurrencies(): Promise<Currency[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name, symbol")
    .order("name");
  return (data ?? []) as Currency[];
}

export async function getOrdersForPicker(): Promise<OrderForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, order_qty, buyers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const buyer = row.buyers as Record<string, unknown> | null;
    return {
      id: row.id as string,
      order_number: (row.order_number as string | null) ?? null,
      buyer_name: (buyer?.name as string | null) ?? null,
      order_qty: (row.order_qty as number) ?? 0,
    };
  });
}

/**
 * Fetch fabric + material BOM data for the given orders and return
 * pre-computed budget lines (without budget_id — caller adds that).
 */
export async function getBomSourceLines(orderIds: string[]): Promise<BomSourceLine[]> {
  if (orderIds.length === 0) return [];

  const supabase = await createClient();

  // order quantities needed for per-piece consumption scaling
  const { data: orders } = await supabase
    .from("sales_orders")
    .select("id, order_qty")
    .in("id", orderIds);

  const orderQtyMap = new Map<string, number>(
    ((orders ?? []) as { id: string; order_qty: number }[]).map((o) => [
      o.id,
      o.order_qty ?? 1,
    ]),
  );

  const [{ data: fabricBoms }, { data: materialBoms }] = await Promise.all([
    supabase
      .from("fabric_boms")
      .select("id, sales_order_id, fabric_bom_components(*)")
      .in("sales_order_id", orderIds),
    supabase
      .from("material_boms")
      .select("id, sales_order_id, material_bom_items(*)")
      .in("sales_order_id", orderIds),
  ]);

  const lines: BomSourceLine[] = [];
  let sortOrder = 0;

  // fabric components: qty = net_consumption × order_qty; unit_cost is 0 (not stored in fabric BOMs)
  for (const bom of (fabricBoms ?? []) as Record<string, unknown>[]) {
    const salesOrderId = bom.sales_order_id as string;
    const orderQty = orderQtyMap.get(salesOrderId) ?? 1;
    const components = (bom.fabric_bom_components ?? []) as Record<string, unknown>[];

    for (const comp of components) {
      const consumption = (comp.consumption as number) ?? 0;
      const lossPct = (comp.process_loss_pct as number) ?? 0;
      const qty = netConsumption(consumption, lossPct) * orderQty;
      const unitCost = 0;
      const amount = lineAmount(qty, unitCost);

      const name = (comp.component_name as string) ?? "";
      const color = comp.color as string | null;
      const size = comp.size as string | null;
      const desc = [name, color, size].filter(Boolean).join(" / ");

      lines.push({
        sales_order_id: salesOrderId,
        source: "fabric",
        description: desc || name,
        quantity: qty,
        unit_cost: unitCost,
        amount,
        sort_order: sortOrder++,
      });
    }
  }

  // material items: qty = effectiveMaterialQty × order_qty; unit_cost from BOM item
  for (const bom of (materialBoms ?? []) as Record<string, unknown>[]) {
    const salesOrderId = bom.sales_order_id as string;
    const orderQty = orderQtyMap.get(salesOrderId) ?? 1;
    const items = (bom.material_bom_items ?? []) as Record<string, unknown>[];

    for (const item of items) {
      const quantityBasis = (item.quantity_basis as "nos" | "moq") ?? "nos";
      const quantityNos = (item.quantity_nos as number) ?? 0;
      const moq = (item.moq as number | null) ?? null;
      const effectiveQty = effectiveMaterialQty({
        quantity_basis: quantityBasis,
        quantity_nos: quantityNos,
        moq,
      });
      const qty = effectiveQty * orderQty;
      const unitCost = (item.unit_cost as number) ?? 0;
      const amount = lineAmount(qty, unitCost);

      const description = (item.description as string) ?? "";
      const attribute = item.attribute as string | null;
      const desc = [description, attribute].filter(Boolean).join(" / ");

      lines.push({
        sales_order_id: salesOrderId,
        source: "material",
        description: desc || description,
        quantity: qty,
        unit_cost: unitCost,
        amount,
        sort_order: sortOrder++,
      });
    }
  }

  return lines;
}
