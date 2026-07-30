import { z } from "zod";

// ============================================================================
// Material Planning Types — Phase 4 (5 forms for Raagam, ver_30A)
//
// 1. Material Excess Plan (FrmMaterialExcessPlan)
// 2. Material Rate       (FrmMaterialRate)
// 3. Fabric Order        (FrmFabricOrder)
// 4. Fabric Consumption  (FrmFabricConsumption)
// 5. Excess Order        (FrmExcess_Order)
// ============================================================================

// --- Shared enums ---

export const MP_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type MpStatus = (typeof MP_STATUSES)[number];

export const ALLOWANCE_TYPES = ["P", "F", "R"] as const;  // Percentage / Flat / Rounded
export const ALLOWANCE_TYPE_LABELS: Record<string, string> = {
  P: "Percentage", F: "Flat", R: "Rounded",
};

export const CATEGORY_TYPES = ["C", "F", "W"] as const;  // Circular / Flat / Woven
export const CATEGORY_TYPE_LABELS: Record<string, string> = {
  C: "Circular", F: "Flat", W: "Woven",
};

export const FABRIC_STAGES = ["GREY", "DYED", "WASH", "PRINT"] as const;
export type FabricStage = (typeof FABRIC_STAGES)[number];


// ============================================================================
// 1. MATERIAL EXCESS PLAN — Interfaces
// ============================================================================

export interface MaterialExcessPlan {
  id: string;
  code: string | null;
  entry_date: string;
  customer_id: string | null;
  group_no: string | null;
  group_description: string | null;
  parent_group_no: string | null;
  is_allowance_from_base: boolean;
  status: MpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialExcessPlanRow extends MaterialExcessPlan {
  customer_name: string | null;
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
  wt_for_plan: number;
  allowance_type_to_order: string;
  allowed_to_order: number;
  allowance_type_to_issue: string;
  allowed_to_issue: number;
  allowance_type_to_receive: string;
  allowed_to_receive: number;
  is_size_wise: boolean;
}

export interface MaterialExcessPlanSize {
  id: string;
  item_id: string;
  sno: number;
  item_size: string | null;
  allowed_to_order: number;
  allowed_to_issue: number;
  allowed_to_receive: number;
}


// ============================================================================
// 2. MATERIAL RATE — Interfaces
// ============================================================================

export interface MaterialRate {
  id: string;
  code: string | null;
  entry_date: string;
  customer_id: string | null;
  group_no: string | null;
  group_description: string | null;
  parent_group_no: string | null;
  status: MpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialRateRow extends MaterialRate {
  customer_name: string | null;
}

export interface MaterialRateItem {
  id: string;
  material_rate_id: string;
  sno: number;
  description: string | null;
  rate_uom_id: string | null;
  rate: number;
}


// ============================================================================
// 3. FABRIC ORDER — Interfaces
// ============================================================================

export interface FabricOrder {
  id: string;
  code: string | null;
  oc_date: string;
  customer_id: string | null;
  order_no: string | null;
  is_repeat_order: boolean;
  amendment_no: number;
  order_date: string | null;
  delivery_date: string | null;
  currency_code: string;
  exchange_rate: number;
  ship_type: string | null;
  ship_mode: string | null;
  pay_mode: string | null;
  received_date: string | null;
  customer_contact: string | null;
  customer_department: string | null;
  agent_name: string | null;
  pay_terms: string | null;
  country_id: string | null;
  receipt_mode: string | null;
  season: string | null;
  season_year: number | null;
  gross_value: number;
  bonus: number;
  bonus_type: string | null;
  bonus_rate_mode: string | null;
  buyer_commission: number;
  buyer_commission_type: string | null;
  buyer_commission_rate_mode: string | null;
  agent_commission: number;
  agent_commission_type: string | null;
  agent_commission_rate_mode: string | null;
  discount: number;
  discount_type: string | null;
  discount_rate_mode: string | null;
  less_other_desc_1: string | null;
  less_other_type_1: string | null;
  less_other_value_1: number;
  less_other_rate_mode_1: string | null;
  less_other_desc_2: string | null;
  less_other_type_2: string | null;
  less_other_value_2: number;
  less_other_rate_mode_2: string | null;
  add_other_desc_1: string | null;
  add_other_type_1: string | null;
  add_other_value_1: number;
  add_other_rate_mode_1: string | null;
  add_other_desc_2: string | null;
  add_other_type_2: string | null;
  add_other_value_2: number;
  add_other_rate_mode_2: string | null;
  status: MpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricOrderRow extends FabricOrder {
  customer_name: string | null;
}

export interface FabricOrderColor {
  id: string;
  fabric_order_id: string;
  color_type: string;
  sno: number;
  type_code: string | null;
  description: string | null;
  process_loss_pct: number;
}

export interface FabricOrderStructure {
  id: string;
  fabric_order_id: string;
  sno: number;
  category_name: string | null;
}

export interface FabricOrderStyle {
  id: string;
  fabric_order_id: string;
  sno: number;
  style_ref_no: string | null;
  article_no: string | null;
  delivery_date: string | null;
}

export interface FabricOrderDetail {
  id: string;
  style_id: string;
  sno: number;
  category_name: string | null;
  fabric_description: string | null;
  category_type: string | null;
  description: string | null;
  gsm: number | null;
  fabric_type: string | null;
  stage: string | null;
  uom_id: string | null;
  plan_uom_id: string | null;
  plan_uom_conv: number;
  order_qty: number;
  rate: number;
  freight_per_piece: number;
  insurance_per_piece: number;
  total_value: number;
  plan_qty: number;
}

export interface FabricOrderCombo {
  id: string;
  detail_id: string;
  sno: number;
  item_color: string | null;
  print_name: string | null;
  specification: string | null;
  order_qty: number;
  rate: number;
  total_value: number;
  plan_qty: number;
}

export interface FabricOrderSize {
  id: string;
  combo_id: string | null;
  detail_id: string | null;
  sno: number;
  item_size: string | null;
  uom_id: string | null;
  plan_uom_id: string | null;
  plan_uom_conv: number;
  order_qty: number;
  wt_per_uom: number;
  rate: number;
  total_value: number;
  plan_qty: number;
}


// ============================================================================
// 4. FABRIC CONSUMPTION — Interfaces
// ============================================================================

export interface FabricConsumption {
  id: string;
  code: string | null;
  uom_id: string | null;
  stock_uom_id: string | null;
  prod_uom_id: string | null;
  sales_uom_id: string | null;
  size_group_no: string | null;
  hsn_code: string | null;
  no_of_coordinates: number;
  coordinate_1: string | null;
  coordinate_2: string | null;
  coordinate_3: string | null;
  coordinate_4: string | null;
  coordinate_5: string | null;
  coordinate_6: string | null;
  customer_style_description: string | null;
  status: MpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricConsumptionComponent {
  id: string;
  consumption_id: string;
  sno: number;
  coordinate: string | null;
  component: string | null;
  category_name: string | null;
  item_type: string | null;
  can_be_sewing_accessories: boolean;
  sewing_category_name: string | null;
  is_main_component: boolean;
}

export interface FabricConsumptionEntry {
  id: string;
  consumption_id: string;
  sno: number;
  fabric: string | null;
  multiple_components: string | null;
  components: string | null;
  entry_no: string | null;
}

export interface FabricConsumptionSize {
  id: string;
  entry_id: string;
  sno: number;
  item_size: string | null;
  dia: string | null;
  qty: number;
  wt: number;
}

export interface FabricConsumptionCombo {
  id: string;
  consumption_id: string;
  sno: number;
  combo: string | null;
  combo_description: string | null;
}

export interface FabricConsumptionGarmentSize {
  id: string;
  consumption_id: string;
  sno: number;
  garment_size: string | null;
  pcs_per_box: number;
  production_ratio: number;
  minimum_stock: number;
}


// ============================================================================
// 5. EXCESS ORDER — Interfaces
// ============================================================================

export interface ExcessOrder {
  id: string;
  code: string | null;
  req_date: string;
  ppm_code: string | null;
  garment_ppm_id: string | null;
  customer_name: string | null;
  sq_no: string | null;
  status: MpStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExcessOrderItem {
  id: string;
  excess_order_id: string;
  sno: number;
  item_class_name: string | null;
  description: string | null;
  uom_id: string | null;
  qty: number;
  is_size_wise: boolean;
}

export interface ExcessOrderSize {
  id: string;
  item_id: string;
  sno: number;
  item_size: string | null;
  qty: number;
}


// ============================================================================
// ZOD INPUT SCHEMAS
// ============================================================================

// --- Material Excess Plan ---

export const materialExcessPlanSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  allowed_to_order: z.coerce.number().min(0).default(0),
  allowed_to_issue: z.coerce.number().min(0).default(0),
  allowed_to_receive: z.coerce.number().min(0).default(0),
});

export const materialExcessPlanItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_class_name: z.string().optional(),
  description: z.string().optional(),
  process_name: z.string().optional(),
  uom_id: z.string().optional(),
  qty_for_plan: z.coerce.number().min(0).default(0),
  wt_for_plan: z.coerce.number().min(0).default(0),
  allowance_type_to_order: z.enum(ALLOWANCE_TYPES).default("P"),
  allowed_to_order: z.coerce.number().min(0).default(0),
  allowance_type_to_issue: z.enum(ALLOWANCE_TYPES).default("P"),
  allowed_to_issue: z.coerce.number().min(0).default(0),
  allowance_type_to_receive: z.enum(ALLOWANCE_TYPES).default("P"),
  allowed_to_receive: z.coerce.number().min(0).default(0),
  is_size_wise: z.boolean().default(false),
  sizes: z.array(materialExcessPlanSizeSchema).default([]),
});

export const materialExcessPlanInputSchema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  customer_id: z.string().min(1, "Customer is required"),
  group_no: z.string().optional(),
  group_description: z.string().optional(),
  parent_group_no: z.string().optional(),
  is_allowance_from_base: z.boolean().default(false),
  location_id: z.string().optional(),
  items: z.array(materialExcessPlanItemSchema).min(1, "At least one item is required"),
});

export type MaterialExcessPlanInput = z.infer<typeof materialExcessPlanInputSchema>;

// --- Material Rate ---

export const materialRateItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  description: z.string().optional(),
  rate_uom_id: z.string().optional(),
  rate: z.coerce.number().min(0).default(0),
});

export const materialRateInputSchema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  customer_id: z.string().min(1, "Customer is required"),
  group_no: z.string().optional(),
  group_description: z.string().optional(),
  parent_group_no: z.string().optional(),
  location_id: z.string().optional(),
  items: z.array(materialRateItemSchema).min(1, "At least one item is required"),
});

export type MaterialRateInput = z.infer<typeof materialRateInputSchema>;

// --- Fabric Order ---

export const fabricOrderColorSchema = z.object({
  id: z.string().optional(),
  color_type: z.string().min(1, "Color type is required"),
  sno: z.coerce.number().int().min(0),
  type_code: z.string().optional(),
  description: z.string().optional(),
  process_loss_pct: z.coerce.number().min(0).default(0),
});

export const fabricOrderStructureSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  category_name: z.string().optional(),
});

export const fabricOrderSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  uom_id: z.string().optional(),
  plan_uom_id: z.string().optional(),
  plan_uom_conv: z.coerce.number().min(0).default(1),
  order_qty: z.coerce.number().min(0).default(0),
  wt_per_uom: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  total_value: z.coerce.number().min(0).default(0),
  plan_qty: z.coerce.number().min(0).default(0),
});

export const fabricOrderComboSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_color: z.string().optional(),
  print_name: z.string().optional(),
  specification: z.string().optional(),
  order_qty: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  total_value: z.coerce.number().min(0).default(0),
  plan_qty: z.coerce.number().min(0).default(0),
  sizes: z.array(fabricOrderSizeSchema).default([]),
});

export const fabricOrderDetailSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  category_name: z.string().optional(),
  fabric_description: z.string().optional(),
  category_type: z.string().optional(),
  description: z.string().optional(),
  gsm: z.coerce.number().int().optional(),
  fabric_type: z.string().optional(),
  stage: z.string().optional(),
  uom_id: z.string().optional(),
  plan_uom_id: z.string().optional(),
  plan_uom_conv: z.coerce.number().min(0).default(1),
  order_qty: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  freight_per_piece: z.coerce.number().min(0).default(0),
  insurance_per_piece: z.coerce.number().min(0).default(0),
  total_value: z.coerce.number().min(0).default(0),
  plan_qty: z.coerce.number().min(0).default(0),
  combos: z.array(fabricOrderComboSchema).default([]),
  sizes: z.array(fabricOrderSizeSchema).default([]),
});

export const fabricOrderStyleSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  style_ref_no: z.string().optional(),
  article_no: z.string().optional(),
  delivery_date: z.string().optional(),
  details: z.array(fabricOrderDetailSchema).default([]),
});

export const fabricOrderInputSchema = z.object({
  oc_date: z.string().min(1, "Date is required"),
  customer_id: z.string().min(1, "Customer is required"),
  order_no: z.string().optional(),
  is_repeat_order: z.boolean().default(false),
  amendment_no: z.coerce.number().int().min(0).default(0),
  order_date: z.string().optional(),
  delivery_date: z.string().optional(),
  currency_code: z.string().default("INR"),
  exchange_rate: z.coerce.number().min(0).default(1),
  ship_type: z.string().optional(),
  ship_mode: z.string().optional(),
  pay_mode: z.string().optional(),
  received_date: z.string().optional(),
  customer_contact: z.string().optional(),
  customer_department: z.string().optional(),
  agent_name: z.string().optional(),
  pay_terms: z.string().optional(),
  country_id: z.string().optional(),
  receipt_mode: z.string().optional(),
  season: z.string().optional(),
  season_year: z.coerce.number().int().optional(),
  bonus: z.coerce.number().min(0).default(0),
  bonus_type: z.string().optional(),
  bonus_rate_mode: z.string().optional(),
  buyer_commission: z.coerce.number().min(0).default(0),
  buyer_commission_type: z.string().optional(),
  buyer_commission_rate_mode: z.string().optional(),
  agent_commission: z.coerce.number().min(0).default(0),
  agent_commission_type: z.string().optional(),
  agent_commission_rate_mode: z.string().optional(),
  discount: z.coerce.number().min(0).default(0),
  discount_type: z.string().optional(),
  discount_rate_mode: z.string().optional(),
  less_other_desc_1: z.string().optional(),
  less_other_type_1: z.string().optional(),
  less_other_value_1: z.coerce.number().min(0).default(0),
  less_other_rate_mode_1: z.string().optional(),
  less_other_desc_2: z.string().optional(),
  less_other_type_2: z.string().optional(),
  less_other_value_2: z.coerce.number().min(0).default(0),
  less_other_rate_mode_2: z.string().optional(),
  add_other_desc_1: z.string().optional(),
  add_other_type_1: z.string().optional(),
  add_other_value_1: z.coerce.number().min(0).default(0),
  add_other_rate_mode_1: z.string().optional(),
  add_other_desc_2: z.string().optional(),
  add_other_type_2: z.string().optional(),
  add_other_value_2: z.coerce.number().min(0).default(0),
  add_other_rate_mode_2: z.string().optional(),
  location_id: z.string().optional(),
  // Child collections
  colors: z.array(fabricOrderColorSchema).default([]),
  structures: z.array(fabricOrderStructureSchema).default([]),
  styles: z.array(fabricOrderStyleSchema).default([]),
});

export type FabricOrderInput = z.infer<typeof fabricOrderInputSchema>;

// --- Fabric Consumption ---

export const fabricConsumptionComponentSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  coordinate: z.string().optional(),
  component: z.string().optional(),
  category_name: z.string().optional(),
  item_type: z.string().optional(),
  can_be_sewing_accessories: z.boolean().default(false),
  sewing_category_name: z.string().optional(),
  is_main_component: z.boolean().default(false),
});

export const fabricConsumptionSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  dia: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
});

export const fabricConsumptionEntrySchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  fabric: z.string().optional(),
  multiple_components: z.string().optional(),
  components: z.string().optional(),
  entry_no: z.string().optional(),
  sizes: z.array(fabricConsumptionSizeSchema).default([]),
});

export const fabricConsumptionComboSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  combo: z.string().optional(),
  combo_description: z.string().optional(),
});

export const fabricConsumptionGarmentSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  garment_size: z.string().optional(),
  pcs_per_box: z.coerce.number().int().min(0).default(0),
  production_ratio: z.coerce.number().int().min(0).default(0),
  minimum_stock: z.coerce.number().int().min(0).default(0),
});

export const fabricConsumptionInputSchema = z.object({
  uom_id: z.string().optional(),
  stock_uom_id: z.string().optional(),
  prod_uom_id: z.string().optional(),
  sales_uom_id: z.string().optional(),
  size_group_no: z.string().optional(),
  hsn_code: z.string().optional(),
  no_of_coordinates: z.coerce.number().int().min(0).default(0),
  coordinate_1: z.string().optional(),
  coordinate_2: z.string().optional(),
  coordinate_3: z.string().optional(),
  coordinate_4: z.string().optional(),
  coordinate_5: z.string().optional(),
  coordinate_6: z.string().optional(),
  customer_style_description: z.string().optional(),
  location_id: z.string().optional(),
  // Child collections
  components: z.array(fabricConsumptionComponentSchema).default([]),
  entries: z.array(fabricConsumptionEntrySchema).default([]),
  combos: z.array(fabricConsumptionComboSchema).default([]),
  garment_sizes: z.array(fabricConsumptionGarmentSizeSchema).default([]),
});

export type FabricConsumptionInput = z.infer<typeof fabricConsumptionInputSchema>;

// --- Excess Order ---

export const excessOrderSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
});

export const excessOrderItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_class_name: z.string().optional(),
  description: z.string().optional(),
  uom_id: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  is_size_wise: z.boolean().default(false),
  sizes: z.array(excessOrderSizeSchema).default([]),
});

export const excessOrderInputSchema = z.object({
  req_date: z.string().min(1, "Date is required"),
  ppm_code: z.string().optional(),
  garment_ppm_id: z.string().optional(),
  customer_name: z.string().optional(),
  sq_no: z.string().optional(),
  location_id: z.string().optional(),
  items: z.array(excessOrderItemSchema).min(1, "At least one item is required"),
});

export type ExcessOrderInput = z.infer<typeof excessOrderInputSchema>;
