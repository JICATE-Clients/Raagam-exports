import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { getTaActivities } from "@/lib/orders/ta-activities/service";
import type { TaStyle } from "./types";

export type PickerRow = { id: string; code: string | null; name: string };

export interface TaStyleFormData {
  customers: PickerRow[];
  /** Activity catalogue for the Activity / From Activity pickers. */
  activities: PickerRow[];
}

/** All TA Style templates (newest first) with customer + activity grid. */
export async function getTaStyles(): Promise<TaStyle[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_styles")
    .select(
      `*, customer:customers(id, code, name),
       activities:ta_style_activities(*)`,
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as TaStyle[];
  // Keep grid rows in sno order.
  rows.forEach((r) => r.activities?.sort((a, b) => a.sno - b.sno));
  return rows;
}

/** Picker option lists for the editor. */
export async function getTaStyleFormData(): Promise<TaStyleFormData> {
  const [customers, activities] = await Promise.all([
    listCustomers(),
    getTaActivities(),
  ]);
  return {
    customers: customers.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    activities: activities.map((a) => ({
      id: a.id,
      code: a.short_name,
      name: a.name,
    })),
  };
}
