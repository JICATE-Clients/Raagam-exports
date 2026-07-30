import { z } from "zod";

// ============================================================================
// Production Planning Types — Phase 5 (2 forms for Raagam, ver_30A)
//
// 1. Capacity Planning  (FrmCapacityPlanning)
// 2. Production Planning (FrmProductionPlanning)
// ============================================================================

// --- Shared enums ---

export const PP_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PpStatus = (typeof PP_STATUSES)[number];

export const DATE_TYPES = ["E", "P", "D"] as const; // Plan Period / Plan Date / Delivery Date
export const DATE_TYPE_LABELS: Record<string, string> = {
  E: "Plan Period",
  P: "Plan Date",
  D: "Delivery Date",
};


// ============================================================================
// 1. CAPACITY PLANNING — Interfaces
// ============================================================================

export interface CapacityPlan {
  id: string;
  code: string | null;
  plan_date: string;
  date_type: string | null;
  from_date: string | null;
  to_date: string | null;
  status: PpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapacityPlanOrder {
  id: string;
  capacity_plan_id: string;
  sno: number;
  plan_no: number;
  plan_date: string | null;
  sc_no: string | null;
  order_no: string | null;
  customer_name: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  order_qty: number;
  delivery_date: string | null;
  with_learning_curve: boolean;
  is_split: boolean;
  sam: number;
  m_os: number;
  qty_100_pct: number;
  target_qty: number;
  target_efficiency: number;
  location_name: string | null;
  team_name: string | null;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapacityPlanDetail {
  id: string;
  order_id: string;
  sno: number;
  location_name: string | null;
  team_name: string | null;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
  updated_at: string;
}


// ============================================================================
// 2. PRODUCTION PLANNING — Interfaces
// ============================================================================

export interface ProductionPlan {
  id: string;
  code: string | null;
  plan_date: string;
  date_type: string | null;
  from_date: string | null;
  to_date: string | null;
  status: PpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionPlanOrder {
  id: string;
  production_plan_id: string;
  sno: number;
  plan_no: string | null;
  plan_date: string | null;
  wo_no: string | null;
  sc_no: string | null;
  order_no: string | null;
  customer_name: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  order_qty: number;
  delivery_date: string | null;
  with_learning_curve: boolean;
  is_split: boolean;
  sam: number;
  target_qty: number;
  target_efficiency: number;
  location_name: string | null;
  team_name: string | null;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionPlanDetail {
  id: string;
  order_id: string;
  sno: number;
  location_name: string | null;
  team_name: string | null;
  plan_qty: number;
  days_required: number;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
  updated_at: string;
}


// ============================================================================
// ZOD INPUT SCHEMAS
// ============================================================================

// --- Capacity Plan Detail (child of order) ---
export const capacityPlanDetailSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  location_name: z.string().optional(),
  team_name: z.string().optional(),
  plan_qty: z.coerce.number().int().min(0).default(0),
  days_required: z.coerce.number().min(0).default(0),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
});

// --- Capacity Plan Order ---
export const capacityPlanOrderSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  plan_no: z.coerce.number().int().default(0),
  plan_date: z.string().optional(),
  sc_no: z.string().optional(),
  order_no: z.string().optional(),
  customer_name: z.string().optional(),
  style_ref_no: z.string().optional(),
  style_no: z.string().optional(),
  order_qty: z.coerce.number().int().min(0).default(0),
  delivery_date: z.string().optional(),
  with_learning_curve: z.boolean().default(false),
  is_split: z.boolean().default(false),
  sam: z.coerce.number().min(0).default(0),
  m_os: z.coerce.number().min(0).default(0),
  qty_100_pct: z.coerce.number().int().min(0).default(0),
  target_qty: z.coerce.number().int().min(0).default(0),
  target_efficiency: z.coerce.number().min(0).default(0),
  location_name: z.string().optional(),
  team_name: z.string().optional(),
  plan_qty: z.coerce.number().int().min(0).default(0),
  days_required: z.coerce.number().int().min(0).default(0),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  details: z.array(capacityPlanDetailSchema).default([]),
});

// --- Capacity Plan Header ---
export const capacityPlanInputSchema = z.object({
  plan_date: z.string().min(1, "Plan date is required"),
  date_type: z.string().default("E"),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  location_id: z.string().optional(),
  orders: z.array(capacityPlanOrderSchema).default([]),
});

export type CapacityPlanInput = z.infer<typeof capacityPlanInputSchema>;

// --- Production Plan Detail (child of order) ---
export const productionPlanDetailSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  location_name: z.string().optional(),
  team_name: z.string().optional(),
  plan_qty: z.coerce.number().int().min(0).default(0),
  days_required: z.coerce.number().min(0).default(0),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
});

// --- Production Plan Order ---
export const productionPlanOrderSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  plan_no: z.string().optional(),
  plan_date: z.string().optional(),
  wo_no: z.string().optional(),
  sc_no: z.string().optional(),
  order_no: z.string().optional(),
  customer_name: z.string().optional(),
  style_ref_no: z.string().optional(),
  style_no: z.string().optional(),
  order_qty: z.coerce.number().int().min(0).default(0),
  delivery_date: z.string().optional(),
  with_learning_curve: z.boolean().default(false),
  is_split: z.boolean().default(false),
  sam: z.coerce.number().min(0).default(0),
  target_qty: z.coerce.number().int().min(0).default(0),
  target_efficiency: z.coerce.number().min(0).default(0),
  location_name: z.string().optional(),
  team_name: z.string().optional(),
  plan_qty: z.coerce.number().int().min(0).default(0),
  days_required: z.coerce.number().int().min(0).default(0),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  details: z.array(productionPlanDetailSchema).default([]),
});

// --- Production Plan Header ---
export const productionPlanInputSchema = z.object({
  plan_date: z.string().min(1, "Plan date is required"),
  date_type: z.string().default("E"),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  location_id: z.string().optional(),
  orders: z.array(productionPlanOrderSchema).default([]),
});

export type ProductionPlanInput = z.infer<typeof productionPlanInputSchema>;
