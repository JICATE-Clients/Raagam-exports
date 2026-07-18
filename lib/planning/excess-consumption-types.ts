import { z } from "zod";

// ---------------------------------------------------------------------------
// Material Excess Plan
// ---------------------------------------------------------------------------

export const ALLOWANCE_TYPES = ["pct", "qty", "mtr", "wt"] as const;

export interface MaterialExcessPlan {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  sq_no: string | null;
  sq_description: string | null;
  customer_id: string | null;
  entry_date: string;
  is_allowance_from_base: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialExcessPlanItem {
  id: string;
  excess_plan_id: string;
  sno: number;
  item_class_name: string | null;
  description: string | null;
  process_name: string | null;
  uom_id: string | null;
  qty_for_plan: number;
  allowance_type_order: string | null;
  allowance_value_order: number;
  allowed_to_order: number;
  allowance_type_issue: string | null;
  allowance_value_issue: number;
  allowed_to_issue: number;
  allowance_type_receive: string | null;
  allowance_value_receive: number;
  allowed_to_receive: number;
}

export const materialExcessPlanInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  sq_no: z.string().optional().nullable(),
  sq_description: z.string().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  entry_date: z.string(),
  is_allowance_from_base: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_class_name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    process_name: z.string().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    qty_for_plan: z.coerce.number().default(0),
    allowance_type_order: z.enum(ALLOWANCE_TYPES).optional().nullable(),
    allowance_value_order: z.coerce.number().default(0),
    allowance_type_issue: z.enum(ALLOWANCE_TYPES).optional().nullable(),
    allowance_value_issue: z.coerce.number().default(0),
    allowance_type_receive: z.enum(ALLOWANCE_TYPES).optional().nullable(),
    allowance_value_receive: z.coerce.number().default(0),
  })).default([]),
});
export type MaterialExcessPlanInput = z.infer<typeof materialExcessPlanInput>;

// ---------------------------------------------------------------------------
// Fabric Consumption
// ---------------------------------------------------------------------------

export interface FabricConsumptionRecord {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  entry_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricConsumptionLine {
  id: string;
  consumption_id: string;
  sno: number;
  fabric_name: string | null;
  structure_name: string | null;
  component: string | null;
  coordinate: string | null;
  fabric_color: string | null;
  fabric_print: string | null;
  gsm: number | null;
  process_type: string | null;
  uom_id: string | null;
  consumption_qty: number;
  consumption_wt: number;
}

export const fabricConsumptionInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  style_ref_no: z.string().optional().nullable(),
  style_no: z.string().optional().nullable(),
  entry_date: z.string(),
  notes: z.string().optional().nullable(),
  lines: z.array(z.object({
    fabric_name: z.string().optional().nullable(),
    structure_name: z.string().optional().nullable(),
    component: z.string().optional().nullable(),
    coordinate: z.string().optional().nullable(),
    fabric_color: z.string().optional().nullable(),
    gsm: z.coerce.number().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    consumption_qty: z.coerce.number().default(0),
    consumption_wt: z.coerce.number().default(0),
  })).default([]),
});
export type FabricConsumptionInput = z.infer<typeof fabricConsumptionInput>;
