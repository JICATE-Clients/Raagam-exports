import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerItem } from "@/components/masters/record-picker";
import type { TaPlanDoc } from "./types";

/** Sales-order option for SC No picker (drives Customer/Order No/Qty/Deliv auto-fill). */
export type OrderRow = {
  id: string;
  order_number: string | null;
  buyer_id: string | null;
  order_qty: number | null;
  ship_date: string | null;
};

export async function getTaPlans(): Promise<TaPlanDoc[]> {
  const s = await createClient();
  const { data } = await s
    .from("ta_plan_docs")
    .select(
      "*, customer:buyers(id, name), sales_order:sales_orders(id, order_number), " +
        "shipment:shipment_plans(id, code, name), style:garment_styles(id, code, style_name), " +
        "activities:ta_plan_activities(" +
        "*, activity:ta_activities!ta_plan_activities_activity_id_fkey(id, short_name, name), " +
        "from_activity:ta_activities!ta_plan_activities_from_activity_id_fkey(id, short_name, name))",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as TaPlanDoc[]).map((d) => ({
    ...d,
    activities: [...(d.activities ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}

export type TaPlanFormData = {
  buyers: PickerItem[];
  orders: OrderRow[];
  shipmentPlans: PickerItem[];
  styles: PickerItem[];
  activities: PickerItem[];
};

export async function getTaPlanFormData(): Promise<TaPlanFormData> {
  const s = await createClient();
  const [buyerRes, orderRes, shipRes, styleRes, actRes] = await Promise.all([
    s.from("buyers").select("id, code, name, is_active").order("name"),
    s
      .from("sales_orders")
      .select("id, order_number, buyer_id, order_qty, ship_date")
      .not("status", "in", "(cancelled)")
      .order("created_at", { ascending: false }),
    s.from("shipment_plans").select("id, code, name").order("created_at", { ascending: false }),
    s
      .from("garment_styles")
      .select("id, code, style_name, blocked")
      .order("created_at", { ascending: false }),
    // `shipment_plans` has no disable column; the other four carry theirs so the
    // pickers can hide a retired row without losing the one a plan already names.
    s.from("ta_activities").select("id, short_name, name, is_active").order("name"),
  ]);

  return {
    buyers: (buyerRes.data ?? []) as PickerItem[],
    orders: (orderRes.data ?? []) as OrderRow[],
    shipmentPlans: (shipRes.data ?? []) as PickerItem[],
    styles: (
      (styleRes.data ?? []) as {
        id: string;
        code: string | null;
        style_name: string | null;
        blocked: boolean;
      }[]
    ).map((r) => ({ id: r.id, code: r.code, name: r.style_name ?? "(unnamed)", blocked: r.blocked })),
    activities: (
      (actRes.data ?? []) as { id: string; short_name: string; name: string; is_active: boolean }[]
    ).map((a) => ({ id: a.id, code: a.short_name, name: a.name, is_active: a.is_active })),
  };
}
