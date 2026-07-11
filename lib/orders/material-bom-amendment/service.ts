import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import {
  getAcceptedOrdersForBom,
  type AcceptedOrderRow,
} from "@/lib/orders/material-bom-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { MaterialBomAmendment } from "./types";

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
