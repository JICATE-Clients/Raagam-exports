import { z } from "zod";

export interface CapacityPlan {
  id: string;
  code: string | null;
  plan_date: string;
  location_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapacityPlanOrder {
  id: string;
  capacity_plan_id: string;
  sno: number;
  sales_order_id: string | null;
  order_no: string | null;
  customer_name: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  order_qty: number;
  delivery_date: string | null;
  sam: number;
  target_efficiency: number;
  target_qty: number;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  location_name: string | null;
  team_name: string | null;
  with_learning_curve: boolean;
  is_split: boolean;
}

export interface ProductionPlan {
  id: string;
  code: string | null;
  plan_date: string;
  location_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionPlanOrder {
  id: string;
  production_plan_id: string;
  sno: number;
  sales_order_id: string | null;
  work_order_no: string | null;
  order_no: string | null;
  customer_name: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  order_qty: number;
  delivery_date: string | null;
  sam: number;
  target_efficiency: number;
  target_qty: number;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  location_name: string | null;
  team_name: string | null;
  with_learning_curve: boolean;
}

export const capacityPlanInput = z.object({
  plan_date: z.string(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  orders: z.array(z.object({
    order_no: z.string().optional().nullable(),
    customer_name: z.string().optional().nullable(),
    style_ref_no: z.string().optional().nullable(),
    style_no: z.string().optional().nullable(),
    order_qty: z.coerce.number().default(0),
    delivery_date: z.string().optional().nullable(),
    sam: z.coerce.number().default(0),
    target_efficiency: z.coerce.number().default(0),
    target_qty: z.coerce.number().default(0),
    plan_qty: z.coerce.number().default(0),
    period_from: z.string().optional().nullable(),
    period_to: z.string().optional().nullable(),
    location_name: z.string().optional().nullable(),
    team_name: z.string().optional().nullable(),
    with_learning_curve: z.boolean().default(false),
  })).default([]),
});
export type CapacityPlanInput = z.infer<typeof capacityPlanInput>;

export const productionPlanInput = z.object({
  plan_date: z.string(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  orders: z.array(z.object({
    work_order_no: z.string().optional().nullable(),
    order_no: z.string().optional().nullable(),
    customer_name: z.string().optional().nullable(),
    style_ref_no: z.string().optional().nullable(),
    style_no: z.string().optional().nullable(),
    order_qty: z.coerce.number().default(0),
    delivery_date: z.string().optional().nullable(),
    sam: z.coerce.number().default(0),
    target_efficiency: z.coerce.number().default(0),
    target_qty: z.coerce.number().default(0),
    plan_qty: z.coerce.number().default(0),
    period_from: z.string().optional().nullable(),
    period_to: z.string().optional().nullable(),
    location_name: z.string().optional().nullable(),
    team_name: z.string().optional().nullable(),
    with_learning_curve: z.boolean().default(false),
  })).default([]),
});
export type ProductionPlanInput = z.infer<typeof productionPlanInput>;
