import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerItem } from "@/components/masters/record-picker";
import type { TaPlanDoc } from "./types";
import type { TemplateActivity } from "@/lib/ta/template";
import { withCreators } from "@/lib/created-by";

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
        "ta_style:ta_styles(id, code, description), " +
        "activities:ta_plan_activities(" +
        "*, activity:ta_activities!ta_plan_activities_activity_id_fkey(id, short_name, name), " +
        "from_activity:ta_activities!ta_plan_activities_from_activity_id_fkey(id, short_name, name))",
    )
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as unknown as TaPlanDoc[]).map((d) => ({
    ...d,
    activities: [...(d.activities ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}

/**
 * A TA Style template, with everything the copy and the picker need.
 *
 * NOT a `PickerItem`: applying a template needs its ACTIVITIES, and a second
 * round-trip to fetch them once the planner has chosen would put a spinner in
 * the middle of a click. There are a handful of templates and each holds a
 * handful of rows, so they arrive whole.
 *
 * `blocked` is carried because the "Disabled rows" rule is a SELECT-side
 * obligation as much as a UI one: a picker cannot keep the value a record
 * already holds if the service filtered it out in SQL.
 */
export type TaStyleOption = {
  id: string;
  code: string | null;
  description: string | null;
  /** `ta_styles.customer_id` -> **customers**, NOT buyers. See `getTaPlanFormData`. */
  customer_id: string | null;
  lead_days: number | null;
  start_days: number | null;
  blocked: boolean;
  is_draft: boolean;
  activities: TemplateActivity[];
};

export type TaPlanFormData = {
  buyers: PickerItem[];
  /** `buyers.id` -> `buyers.customer_id` (0380, NULLABLE). The bridge between the
   *  plan's party and the template's - see `getTaPlanFormData`. */
  buyerCustomer: Record<string, string | null>;
  taStyles: TaStyleOption[];
  orders: OrderRow[];
  shipmentPlans: PickerItem[];
  styles: PickerItem[];
  activities: PickerItem[];
};

export async function getTaPlanFormData(): Promise<TaPlanFormData> {
  const s = await createClient();
  const [buyerRes, orderRes, shipRes, styleRes, actRes, taStyleRes] = await Promise.all([
    /* `customer_id` (0380) is the BRIDGE and it is nullable. A TA Plan's party is
       a `buyers` row; a TA Style's is a `customers` row. They are different
       tables, so scoping templates to the plan's customer is only possible
       through this column - and where it is null the screen offers every
       template rather than claiming the party has none. Same shape the
       nominated-vendor rule takes for the same reason. */
    s.from("buyers").select("id, code, name, is_active, customer_id").order("name"),
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
    s
      .from("ta_styles")
      .select(
        "id, code, description, customer_id, lead_days, start_days, blocked, is_draft, " +
          "activities:ta_style_activities(sno, activity_id, from_activity_id, days_required)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const buyerRows = (buyerRes.data ?? []) as (PickerItem & { customer_id: string | null })[];

  return {
    buyers: buyerRows,
    buyerCustomer: Object.fromEntries(buyerRows.map((b) => [b.id, b.customer_id ?? null])),
    taStyles: ((taStyleRes.data ?? []) as unknown as TaStyleOption[]).map((t) => ({
      ...t,
      // Sorted here so every consumer - the copy, the summary and the picker's
      // row count - reads one order, the way `getTaStyles` already does.
      activities: [...(t.activities ?? [])].sort((a, b) => a.sno - b.sno),
    })),
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
