import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { MaterialBomAmendment } from "./types";

/** Accepted order for the BOM amendment picker. */
export type AcceptedOrderRow = {
  id: string;
  order_number: string | null;
  created_at: string;
  ship_date: string | null;
  order_qty: number;
  status: string;
  buyer_name: string | null;
};

async function getAcceptedOrdersForBom(): Promise<AcceptedOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number, created_at, ship_date, order_qty, status, buyers(name)")
    .not("status", "in", "(cancelled,closed)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    order_number: string | null;
    created_at: string;
    ship_date: string | null;
    order_qty: number;
    status: string;
    buyers: { name: string } | null;
  }[]).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    created_at: o.created_at,
    ship_date: o.ship_date,
    order_qty: o.order_qty,
    status: o.status,
    buyer_name: o.buyers?.name ?? null,
  }));
}

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

/** All amendments with embedded order + customer + child grids. */
export async function listMaterialBomAmendments(): Promise<MaterialBomAmendment[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_bom_amendments")
    .select(
      "*, sales_orders(id, order_number, order_qty), customer:customers(id,code,name), " +
        "items:material_bom_amendment_items(*), " +
        "processes:material_bom_amendment_processes(*)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as MaterialBomAmendment[]).map((r) => ({
    ...r,
    items: [...(r.items ?? [])].sort((a, b) => a.sno - b.sno),
    processes: [...(r.processes ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}

async function pickerRows(table: string): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from(table).select("id, code, name").order("name");
  return (data ?? []) as PickerRow[];
}

async function getVendorRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("vendors")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

export type MbaFormData = {
  orders: AcceptedOrderRow[];
  customers: Customer[];
  items: PickerRow[];
  vendors: PickerRow[];
  uoms: PickerRow[];
  lookups: ConfigLookup[];
};

/** Every picker option list the amendment editor needs, fetched in parallel. */
export async function getMbaFormData(): Promise<MbaFormData> {
  const [orders, customers, items, vendors, uoms, lookups] = await Promise.all([
    getAcceptedOrdersForBom(),
    listCustomers(),
    pickerRows("items"),
    getVendorRows(),
    pickerRows("uoms"),
    listConfigLookups(),
  ]);
  return { orders, customers, items, vendors, uoms, lookups };
}
