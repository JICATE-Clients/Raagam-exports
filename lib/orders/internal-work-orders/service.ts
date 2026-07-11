import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { InternalWorkOrder, IwoLine } from "./types";

type OrderRef = { id: string; order_number: string | null; buyers: { name: string } | null };
type LocationRef = { id: string; code: string; name: string };
type CustomerRef = { id: string; name: string } | null;
type StyleRef = { id: string; code: string | null; style_name: string | null } | null;

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

export type IwoWithOrder = InternalWorkOrder & {
  sales_orders: OrderRef | null;
  customer: CustomerRef;
  style: StyleRef;
};

export type IwoDetail = InternalWorkOrder & {
  sales_orders: OrderRef | null;
  locations: LocationRef | null;
  customer: CustomerRef;
  style: StyleRef;
};

export async function getInternalWorkOrders(): Promise<IwoWithOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_work_orders")
    .select(
      "*, sales_orders(id, order_number, buyers(name)), " +
        "customer:customers(id, name), style:garment_styles(id, code, style_name)",
    )
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as IwoWithOrder[];
}

/** Picker option lists for the legacy IWO form. */
export type IwoFormData = {
  customers: Customer[];
  employees: PickerRow[];
  styles: PickerRow[];
  itemClasses: ConfigLookup[];
};

export async function getIwoFormData(): Promise<IwoFormData> {
  const supabase = await createClient();
  const [customers, lookups, empRes, styleRes] = await Promise.all([
    listCustomers(),
    listConfigLookups(),
    supabase.from("employees").select("id, code, name").order("name"),
    supabase.from("garment_styles").select("id, code, style_name").order("created_at", { ascending: false }),
  ]);
  const employees = ((empRes.data ?? []) as PickerRow[]).map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
  }));
  const styles = (
    (styleRes.data ?? []) as { id: string; code: string | null; style_name: string | null }[]
  ).map((s) => ({ id: s.id, code: s.code, name: s.style_name ?? "(unnamed style)" }));
  return {
    customers,
    employees,
    styles,
    itemClasses: lookups.filter((l) => l.kind === "item_class"),
  };
}

export async function getInternalWorkOrder(id: string): Promise<IwoDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_work_orders")
    .select(
      "*, sales_orders(id, order_number, buyers(name)), locations(id, code, name), " +
        "customer:customers(id, name), style:garment_styles(id, code, style_name)",
    )
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as IwoDetail | null;
}

export async function getIwoLines(iwoId: string): Promise<IwoLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("iwo_lines")
    .select("*")
    .eq("iwo_id", iwoId)
    .order("sort_order");
  return (data ?? []) as IwoLine[];
}
