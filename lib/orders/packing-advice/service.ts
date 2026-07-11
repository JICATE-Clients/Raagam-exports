import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { PackingAdvice } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

/** A sales order for the per-line SC No picker. */
export type OrderPickerRow = { id: string; order_number: string | null; buyer_name: string | null };

/** All packing advices with embedded customer / consignee + line grid. */
export async function getPackingAdvices(): Promise<PackingAdvice[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_advices")
    .select(
      "*, customer:buyers(id,code,name), consignee:consignees(id,code,name), " +
        "lines:packing_advice_lines(*, sc_no:sales_orders(id,order_number))",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as PackingAdvice[]).map((r) => ({
    ...r,
    lines: [...(r.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}

/** Confirmed sales orders for the SC No picker. */
async function getOrderRows(): Promise<OrderPickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number, buyers(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as {
    id: string;
    order_number: string | null;
    buyers?: { name: string } | null;
  }[]).map((r) => ({ id: r.id, order_number: r.order_number, buyer_name: r.buyers?.name ?? null }));
}

/** Buyers for the header "Customer" picker. */
async function getBuyerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("buyers")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** Consignees for the header "Consignee" picker. */
async function getConsigneeRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("consignees")
    .select("id, code, name")
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** Units of measure for the line "Unit" picker. */
async function getUomRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

export type PackingAdviceFormData = {
  orders: OrderPickerRow[];
  buyers: PickerRow[];
  consignees: PickerRow[];
  uoms: PickerRow[];
  countries: Country[];
  lookups: ConfigLookup[];
};

/** Every picker option list the packing-advice editor needs, fetched in parallel. */
export async function getPackingAdviceFormData(): Promise<PackingAdviceFormData> {
  const [orders, buyers, consignees, uoms, countries, lookups] = await Promise.all([
    getOrderRows(),
    getBuyerRows(),
    getConsigneeRows(),
    getUomRows(),
    listCountries(),
    listConfigLookups(),
  ]);
  return { orders, buyers, consignees, uoms, countries, lookups };
}
