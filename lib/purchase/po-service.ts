import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Vendor,
  Rfq,
  RfqLine,
  RfqQuote,
  PurchaseOrder,
  PoLineItem,
} from "@/lib/purchase/types";
import type { Currency, Item, Uom } from "@/lib/masters/types";

// ---------- derived types ----------

export type VendorForPicker = { id: string; name: string; code: string | null };
export type BudgetForPicker = {
  id: string;
  code: string | null;
  name: string;
  currency_code: string | null;
};
export type LocationForPicker = { id: string; code: string; name: string };
export type BudgetLineRow = {
  id: string;
  description: string;
  quantity: number;
  unit_cost: number;
  sort_order: number;
};
export type RfqQuoteWithVendor = RfqQuote & { vendor_name: string | null };
export type RfqWithDetails = Rfq & {
  lines: RfqLine[];
  quotes: RfqQuoteWithVendor[];
};
export type PoWithVendor = PurchaseOrder & { vendor_name: string | null };
export type PoWithDetails = PoWithVendor & { lines: PoLineItem[] };

// ---------- vendors ----------

export async function listVendors(): Promise<Vendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("*")
    .order("name");
  return (data ?? []) as Vendor[];
}

export async function getVendor(id: string): Promise<Vendor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as Vendor | null;
}

export async function getVendorsForPicker(): Promise<VendorForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as VendorForPicker[];
}

// ---------- RFQs ----------

export async function listRfqs(): Promise<Rfq[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rfqs")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Rfq[];
}

export async function getRfq(id: string): Promise<RfqWithDetails | null> {
  const supabase = await createClient();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!rfq) return null;

  const [{ data: lines }, { data: quotes }] = await Promise.all([
    supabase
      .from("rfq_lines")
      .select("*")
      .eq("rfq_id", id)
      .order("sort_order"),
    supabase
      .from("rfq_quotes")
      .select("*, vendors(name)")
      .eq("rfq_id", id)
      .order("created_at"),
  ]);

  const mappedQuotes: RfqQuoteWithVendor[] = (
    (quotes ?? []) as Record<string, unknown>[]
  ).map((q) => {
    const vendor = q.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = q;
    void _v;
    return {
      ...(rest as unknown as RfqQuote),
      vendor_name: vendor?.name ?? null,
    };
  });

  return {
    ...(rfq as Rfq),
    lines: (lines ?? []) as RfqLine[],
    quotes: mappedQuotes,
  };
}

// ---------- purchase orders ----------

export async function listPurchaseOrders(): Promise<PoWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, vendors(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const vendor = row.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = row;
    void _v;
    return {
      ...(rest as unknown as PurchaseOrder),
      vendor_name: vendor?.name ?? null,
    };
  });
}

export async function getPurchaseOrder(
  id: string,
): Promise<PoWithDetails | null> {
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  if (!po) return null;

  const { data: lines } = await supabase
    .from("po_line_items")
    .select("*")
    .eq("purchase_order_id", id)
    .order("sort_order");

  const poRow = po as Record<string, unknown>;
  const vendor = poRow.vendors as { name: string } | null;
  const { vendors: _v, ...poRest } = poRow;
  void _v;

  return {
    ...(poRest as unknown as PurchaseOrder),
    vendor_name: vendor?.name ?? null,
    lines: (lines ?? []) as PoLineItem[],
  };
}

// ---------- shared pickers ----------

export async function getBudgetsForPicker(): Promise<BudgetForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("id, code, name, currency_code")
    .eq("status", "approved")
    .order("name");
  return (data ?? []) as BudgetForPicker[];
}

export async function getBudgetLines(
  budgetId: string,
): Promise<BudgetLineRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_lines")
    .select("id, description, quantity, unit_cost, sort_order")
    .eq("budget_id", budgetId)
    .order("sort_order");
  return (data ?? []) as BudgetLineRow[];
}

export async function getCurrencies(): Promise<Currency[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name, symbol")
    .order("name");
  return (data ?? []) as Currency[];
}

export async function getLocations(): Promise<LocationForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationForPicker[];
}

export async function getItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name, category, uom_id, is_active")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Item[];
}

export async function getUoms(): Promise<Uom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Uom[];
}
