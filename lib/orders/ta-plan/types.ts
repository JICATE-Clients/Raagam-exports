import { z } from "zod";

// ============================================================================
// TA Plan (0271) — master-detail Time & Action scheduling document.
// Header (ta_plan_docs) + activity grid (ta_plan_activities). Distinct from the
// per-order ta_plans/ta_milestones (0006), which are left untouched.
// ============================================================================

type Ref = { id: string; code: string | null; name: string } | null;
type ActivityRef = { id: string; short_name: string; name: string } | null;

export interface TaPlanActivity {
  id: string;
  plan_id: string;
  sno: number;
  activity_id: string | null;
  from_activity_id: string | null;
  details: string | null;
  start_date: string | null;
  days_required: number | null;
  end_date: string | null;
  // embedded for display
  activity?: ActivityRef;
  from_activity?: ActivityRef;
}

export interface TaPlanDoc {
  id: string;
  code: string | null;
  plan_date: string;
  customer_id: string | null;
  sales_order_id: string | null;
  shipment_plan_id: string | null;
  order_no: string | null;
  start_date: string | null;
  style_id: string | null;
  delivery_date: string | null;
  order_qty: number | null;
  proposed_delivery_date: string | null;
  target_date: string | null;
  no_of_days: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display
  customer?: { id: string; name: string } | null;
  sales_order?: { id: string; order_number: string | null } | null;
  shipment?: Ref;
  style?: { id: string; code: string | null; style_name: string | null } | null;
  activities: TaPlanActivity[];
}

const uuidN = z.string().uuid().nullable().default(null);
const nullableText = z.string().optional().nullable();
const intN = z.coerce.number().int().nullable().default(null);

export const taPlanActivityInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  activity_id: uuidN,
  from_activity_id: uuidN,
  details: nullableText,
  start_date: nullableText,
  days_required: intN,
  end_date: nullableText,
});

export const taPlanDocInput = z.object({
  plan_date: z.string().min(1, "Date is required"),
  customer_id: uuidN,
  sales_order_id: uuidN,
  shipment_plan_id: uuidN,
  order_no: nullableText,
  start_date: nullableText,
  style_id: uuidN,
  delivery_date: nullableText,
  order_qty: z.coerce.number().nullable().default(null),
  proposed_delivery_date: nullableText,
  target_date: nullableText,
  no_of_days: intN,
  activities: z.array(taPlanActivityInput).default([]),
});
export type TaPlanDocInput = z.infer<typeof taPlanDocInput>;
