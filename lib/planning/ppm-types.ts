import { z } from "zod";

// ============================================================================
// PPM Types — All 6 PPM forms for Raagam (company 38, ver_30A)
//
// 1. Garment PPM    (FrmGarment_PPM)       — 5 tabs, 12 bands
// 2. Processing PPM (FrmProcessingPPM)     — 2 tabs
// 3. Purchase PPM   (FrmPurchase_PPM)      — 2 tabs
// 4. PPM Cancel     (FrmPPMCancel)         — 1 tab, 2 bands
// 5. PPM Completion (FrmPPMCompletion)     — header + notes only
// 6. GAR PPM Cancel (FrmGAR_PPMCancellation) — 4-level hierarchy
// ============================================================================

// --- Shared enums ---

export const PPM_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PpmStatus = (typeof PPM_STATUSES)[number];

export const STAGES = ["GREY", "DYED", "PRINT", "WASH"] as const;
export type Stage = (typeof STAGES)[number];

export const GARMENT_STAGES = [
  "FABRIC", "CP", "CB", "CUT", "SW", "CHK", "IRN", "PACK", "BOX",
] as const;

// --- Garment PPM enums ---

export const GARMENT_PPM_RECORD_TYPES = [
  "garmenting", "cutting", "shortage_garmenting",
  "shortage_cutting", "sample_work_order", "rate_amendment",
] as const;
export type GarmentPpmRecordType = (typeof GARMENT_PPM_RECORD_TYPES)[number];

export const ORDER_FOR_OPTIONS = ["B", "S"] as const;  // Bulk / Sample
export const ORDER_FOR_LABELS: Record<string, string> = { B: "Bulk", S: "Sample" };

export const SOURCING_TYPES = ["I", "O"] as const;  // In House / Outside
export const SOURCING_TYPE_LABELS: Record<string, string> = { I: "In House", O: "Outside" };

export const ASSORTMENT_TYPES = ["SC-SS", "SC-AS", "SS-AC", "AC-AS"] as const;

export const RATE_FOR_OPTIONS = ["PRO", "DSN"] as const;  // Processwise / Designwise
export const RATE_FOR_LABELS: Record<string, string> = { PRO: "Processwise", DSN: "Designwise" };

// --- Processing PPM enums ---

export const PROCESSING_PPM_RECORD_TYPES = [
  "processing", "processing_amendment", "processing_for_purchase",
] as const;
export type ProcessingPpmRecordType = (typeof PROCESSING_PPM_RECORD_TYPES)[number];

// --- Purchase PPM enums ---

export const PURCHASE_PPM_RECORD_TYPES = ["purchase", "purchase_amendment"] as const;
export type PurchasePpmRecordType = (typeof PURCHASE_PPM_RECORD_TYPES)[number];

export const ACK_STATUSES = ["N", "A", "R", "V"] as const;
export const ACK_STATUS_LABELS: Record<string, string> = {
  N: "To be Acknowledged", A: "Acknowledged", R: "Returned", V: "Return Acknowledged",
};

// --- Cancel enums ---

export const CANCEL_TYPES = ["B", "P"] as const;  // Balance / Part
export const CANCEL_TYPE_LABELS: Record<string, string> = { B: "Full Cancellation", P: "Part Cancellation" };


// ============================================================================
// 1. GARMENT PPM — Interfaces
// ============================================================================

export interface GarmentPpm {
  id: string;
  code: string | null;
  record_type: GarmentPpmRecordType;
  ppm_date: string;
  department_id: string | null;
  requisitioner_id: string | null;
  description: string | null;
  customer_id: string | null;
  sales_order_id: string | null;
  group_no: string | null;
  group_description: string | null;
  style_id: string | null;
  sc_no: string | null;
  delivery_date: string | null;
  is_full_order: boolean;
  order_for: string;
  cons_multiplier: number;
  sourcing_type: string;
  to_location_id: string | null;
  to_department_id: string | null;
  to_contact_id: string | null;
  vendor_id: string | null;
  stage_from: string | null;
  stage_to: string | null;
  cmt_value: number;
  fabric_issued_value: number;
  garment_process_value: number;
  accessories_value: number;
  gross_value: number;
  overhead_pct: number;
  overhead_value: number;
  net_value: number;
  sew_mat_store: string | null;
  pak_mat_store: string | null;
  reason: string | null;
  task_owner_id: string | null;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GarmentPpmRow extends GarmentPpm {
  customer_name: string | null;
  order_code: string | null;
}

export interface GarmentPpmPack {
  id: string;
  garment_ppm_id: string;
  sno: number;
  sc_no: string | null;
  order_no: string | null;
  country_id: string | null;
  pack: string | null;
  consignee: string | null;
  assortment_type: string | null;
  no_of_cartons: number;
  uom_id: string | null;
  ppm_qty: number;
  delivery_date: string | null;
}

export interface GarmentPpmQuantity {
  id: string;
  garment_ppm_id: string;
  sno: number;
  sc_no: string | null;
  order_no: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  uom_id: string | null;
  order_qty: number;
  excess_qty: number;
  rejection_qty: number;
  approval_qty: number;
  ppm_qty: number;
  rate: number;
  po_value: number;
}

export interface GarmentPpmCoordinate {
  id: string;
  quantity_id: string;
  sno: number;
  coordinate: string | null;
  smvs: number;
  rate: number;
}

export interface GarmentPpmCombo {
  id: string;
  quantity_id: string;
  sno: number;
  combo: string | null;
  order_qty: number;
  excess_qty: number;
  rejection_qty: number;
  approval_qty: number;
  ppm_qty: number;
}

export interface GarmentPpmSize {
  id: string;
  combo_id: string;
  sno: number;
  item_size: string | null;
  order_qty: number;
  excess_qty: number;
  rejection_qty: number;
  approval_qty: number;
  ppm_qty: number;
}

export interface GarmentPpmFabric {
  id: string;
  garment_ppm_id: string;
  sno: number;
  item_name: string | null;
  gsm: number | null;
  vendor_name: string | null;
  stage: string | null;
  item_type: string | null;
  item_color: string | null;
  print_name: string | null;
  specifications: string | null;
  uom_id: string | null;
  process_name: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

export interface GarmentPpmFabricSize {
  id: string;
  fabric_id: string;
  sno: number;
  item_size: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

export interface GarmentPpmProcess {
  id: string;
  garment_ppm_id: string;
  sno: number;
  process_name: string | null;
  rate_for: string;
  rate_for_type: string | null;
  uom_id: string | null;
  qty: number;
  rate_type: string | null;
  rate: number;
  po_value: number;
  is_by_us: boolean;
  is_by_vendor: boolean;
  is_inclusive_rate: boolean;
  is_exclusive_rate: boolean;
}

export interface GarmentPpmProcessItem {
  id: string;
  process_id: string;
  sno: number;
  description: string | null;
  uom_id: string | null;
  qty: number;
  rate: number;
  po_value: number;
  is_by_us: boolean;
}

export interface GarmentPpmAccessory {
  id: string;
  garment_ppm_id: string;
  sno: number;
  item_name: string | null;
  vendor_name: string | null;
  item_color: string | null;
  specifications: string | null;
  uom_id: string | null;
  process_name: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
  is_by_vendor: boolean;
  is_inclusive_rate: boolean;
  is_exclusive_rate: boolean;
}

export interface GarmentPpmAccessorySize {
  id: string;
  accessory_id: string;
  sno: number;
  item_size: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

// ============================================================================
// 2. PROCESSING PPM — Interfaces
// ============================================================================

export interface ProcessingPpm {
  id: string;
  code: string | null;
  record_type: ProcessingPpmRecordType;
  ppm_date: string;
  amendment_no: number;
  department_id: string | null;
  requisitioner_id: string | null;
  customer_id: string | null;
  sales_order_id: string | null;
  group_no: string | null;
  group_description: string | null;
  to_location_id: string | null;
  to_department_id: string | null;
  to_contact_id: string | null;
  gross_value: number;
  input_value: number;
  overhead_pct: number;
  overhead_value: number;
  net_value: number;
  remarks: string | null;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessingPpmRow extends ProcessingPpm {
  customer_name: string | null;
  order_code: string | null;
}

export interface ProcessingPpmItem {
  id: string;
  processing_ppm_id: string;
  sno: number;
  item_class_name: string | null;
  category_name: string | null;
  description: string | null;
  uom_id: string | null;
  process_name: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
  is_size_wise: boolean;
}

export interface ProcessingPpmSize {
  id: string;
  item_id: string;
  sno: number;
  item_size: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

export interface ProcessingPpmYarn {
  id: string;
  processing_ppm_id: string;
  sno: number;
  item_name: string | null;
  stage: string | null;
  item_color: string | null;
  vendor_name: string | null;
  specifications: string | null;
  uom_id: string | null;
  qty: number;
  wt: number;
  rate: number;
  amount: number;
  is_general_stock: boolean;
}

// ============================================================================
// 3. PURCHASE PPM — Interfaces
// ============================================================================

export interface PurchasePpm {
  id: string;
  code: string | null;
  record_type: PurchasePpmRecordType;
  ppm_date: string;
  amendment_no: number;
  department_id: string | null;
  requisitioner_id: string | null;
  customer_id: string | null;
  sales_order_id: string | null;
  group_no: string | null;
  group_description: string | null;
  to_department_id: string | null;
  to_contact_id: string | null;
  gross_value: number;
  overhead_pct: number;
  overhead_value: number;
  net_value: number;
  remarks: string | null;
  ack_status: string;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchasePpmRow extends PurchasePpm {
  customer_name: string | null;
  order_code: string | null;
}

export interface PurchasePpmItem {
  id: string;
  purchase_ppm_id: string;
  sno: number;
  item_class_name: string | null;
  category_name: string | null;
  description: string | null;
  uom_id: string | null;
  is_approval_required: boolean;
  is_size_wise: boolean;
  required_date: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

export interface PurchasePpmSize {
  id: string;
  item_id: string;
  sno: number;
  item_size: string | null;
  qty: number;
  wt: number;
  rate: number;
  po_value: number;
}

// ============================================================================
// 4. PPM CANCEL — Interfaces
// ============================================================================

export interface PpmCancel {
  id: string;
  code: string | null;
  cancel_type: string;
  cancel_date: string;
  customer_id: string | null;
  ppm_id: string | null;
  ppm_date: string | null;
  group_no: string | null;
  group_description: string | null;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PpmCancelRow extends PpmCancel {
  customer_name: string | null;
}

export interface PpmCancelItem {
  id: string;
  ppm_cancel_id: string;
  sno: number;
  item_class_name: string | null;
  category_name: string | null;
  description: string | null;
  uom_id: string | null;
  ppm_qty: number;
  ppm_wt: number;
  cancel_qty: number;
  cancel_wt: number;
  is_size_wise: boolean;
}

export interface PpmCancelSize {
  id: string;
  item_id: string;
  sno: number;
  item_size: string | null;
  ppm_qty: number;
  ppm_wt: number;
  cancel_qty: number;
  cancel_wt: number;
}

// ============================================================================
// 5. PPM COMPLETION — Interfaces
// ============================================================================

export interface PpmCompletion {
  id: string;
  code: string | null;
  entry_date: string;
  customer_id: string | null;
  ppm_id: string | null;
  group_no: string | null;
  group_description: string | null;
  notes: string | null;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PpmCompletionRow extends PpmCompletion {
  customer_name: string | null;
}

// ============================================================================
// 6. GARMENT PPM CANCELLATION — Interfaces (4-level hierarchy)
// ============================================================================

export interface GarmentPpmCancellation {
  id: string;
  code: string | null;
  cancel_date: string;
  garment_ppm_id: string | null;
  ppm_code: string | null;
  customer_name: string | null;
  description: string | null;
  status: PpmStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GarmentPpmCancelStyle {
  id: string;
  cancellation_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  sc_no: string | null;
  order_no: string | null;
  uom_id: string | null;
  cancel_qty: number;
}

export interface GarmentPpmCancelCoordinate {
  id: string;
  style_id: string;
  sno: number;
  coordinate: string | null;
}

export interface GarmentPpmCancelCombo {
  id: string;
  style_id: string;
  sno: number;
  item_color: string | null;
  wo_qty: number;
  received_qty: number;
  cancel_qty: number;
}

export interface GarmentPpmCancelSize {
  id: string;
  combo_id: string;
  sno: number;
  item_size: string | null;
  wo_qty: number;
  received_qty: number;
  cancel_qty: number;
}


// ============================================================================
// ZOD INPUT SCHEMAS
// ============================================================================

// --- Garment PPM ---

export const garmentPpmPackSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  sc_no: z.string().optional(),
  order_no: z.string().optional(),
  country_id: z.string().optional(),
  pack: z.string().optional(),
  consignee: z.string().optional(),
  assortment_type: z.string().optional(),
  no_of_cartons: z.coerce.number().int().min(0).default(0),
  uom_id: z.string().optional(),
  ppm_qty: z.coerce.number().min(0).default(0),
  delivery_date: z.string().optional(),
});

export const garmentPpmSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  order_qty: z.coerce.number().min(0).default(0),
  excess_qty: z.coerce.number().min(0).default(0),
  rejection_qty: z.coerce.number().min(0).default(0),
  approval_qty: z.coerce.number().min(0).default(0),
  ppm_qty: z.coerce.number().min(0).default(0),
});

export const garmentPpmComboSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  combo: z.string().optional(),
  order_qty: z.coerce.number().min(0).default(0),
  excess_qty: z.coerce.number().min(0).default(0),
  rejection_qty: z.coerce.number().min(0).default(0),
  approval_qty: z.coerce.number().min(0).default(0),
  ppm_qty: z.coerce.number().min(0).default(0),
  sizes: z.array(garmentPpmSizeSchema).default([]),
});

export const garmentPpmCoordinateSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  coordinate: z.string().optional(),
  smvs: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
});

export const garmentPpmQuantitySchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  sc_no: z.string().optional(),
  order_no: z.string().optional(),
  style_ref_no: z.string().optional(),
  style_no: z.string().optional(),
  article_no: z.string().optional(),
  uom_id: z.string().optional(),
  order_qty: z.coerce.number().min(0).default(0),
  excess_qty: z.coerce.number().min(0).default(0),
  rejection_qty: z.coerce.number().min(0).default(0),
  approval_qty: z.coerce.number().min(0).default(0),
  ppm_qty: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  coordinates: z.array(garmentPpmCoordinateSchema).default([]),
  combos: z.array(garmentPpmComboSchema).default([]),
});

export const garmentPpmFabricSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
});

export const garmentPpmFabricSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_name: z.string().optional(),
  gsm: z.coerce.number().optional(),
  vendor_name: z.string().optional(),
  stage: z.string().optional(),
  item_type: z.string().optional(),
  item_color: z.string().optional(),
  print_name: z.string().optional(),
  specifications: z.string().optional(),
  uom_id: z.string().optional(),
  process_name: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  sizes: z.array(garmentPpmFabricSizeSchema).default([]),
});

export const garmentPpmProcessItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  description: z.string().optional(),
  uom_id: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  is_by_us: z.boolean().default(false),
});

export const garmentPpmProcessSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  process_name: z.string().optional(),
  rate_for: z.enum(["PRO", "DSN"]).default("PRO"),
  rate_for_type: z.string().optional(),
  uom_id: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  rate_type: z.string().optional(),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  is_by_us: z.boolean().default(false),
  is_by_vendor: z.boolean().default(false),
  is_inclusive_rate: z.boolean().default(false),
  is_exclusive_rate: z.boolean().default(false),
  items: z.array(garmentPpmProcessItemSchema).default([]),
});

export const garmentPpmAccessorySizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
});

export const garmentPpmAccessorySchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_name: z.string().optional(),
  vendor_name: z.string().optional(),
  item_color: z.string().optional(),
  specifications: z.string().optional(),
  uom_id: z.string().optional(),
  process_name: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  is_by_vendor: z.boolean().default(false),
  is_inclusive_rate: z.boolean().default(false),
  is_exclusive_rate: z.boolean().default(false),
  sizes: z.array(garmentPpmAccessorySizeSchema).default([]),
});

export const garmentPpmInputSchema = z.object({
  record_type: z.enum(GARMENT_PPM_RECORD_TYPES).default("garmenting"),
  ppm_date: z.string().min(1, "Date is required"),
  department_id: z.string().min(1, "Department is required"),
  requisitioner_id: z.string().min(1, "Requisitioner is required"),
  description: z.string().optional(),
  customer_id: z.string().min(1, "Customer is required"),
  sales_order_id: z.string().optional(),
  group_no: z.string().optional(),
  group_description: z.string().optional(),
  style_id: z.string().optional(),
  sc_no: z.string().optional(),
  delivery_date: z.string().optional(),
  is_full_order: z.boolean().default(true),
  order_for: z.enum(ORDER_FOR_OPTIONS).default("B"),
  cons_multiplier: z.coerce.number().min(0).default(0),
  sourcing_type: z.enum(SOURCING_TYPES).default("I"),
  to_location_id: z.string().optional(),
  to_department_id: z.string().optional(),
  to_contact_id: z.string().optional(),
  vendor_id: z.string().optional(),
  stage_from: z.string().optional(),
  stage_to: z.string().optional(),
  overhead_pct: z.coerce.number().min(0).default(0),
  fabric_issued_value: z.coerce.number().min(0).default(0),
  sew_mat_store: z.string().optional(),
  pak_mat_store: z.string().optional(),
  reason: z.string().optional(),
  task_owner_id: z.string().optional(),
  location_id: z.string().optional(),
  // Child collections
  packs: z.array(garmentPpmPackSchema).default([]),
  quantities: z.array(garmentPpmQuantitySchema).min(1, "At least one quantity row is required"),
  fabrics: z.array(garmentPpmFabricSchema).default([]),
  processes: z.array(garmentPpmProcessSchema).default([]),
  accessories: z.array(garmentPpmAccessorySchema).default([]),
});

export type GarmentPpmInput = z.infer<typeof garmentPpmInputSchema>;

// --- Processing PPM ---

export const processingPpmSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
});

export const processingPpmItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_class_name: z.string().optional(),
  category_name: z.string().optional(),
  description: z.string().optional(),
  uom_id: z.string().optional(),
  process_name: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  is_size_wise: z.boolean().default(false),
  sizes: z.array(processingPpmSizeSchema).default([]),
});

export const processingPpmYarnSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_name: z.string().optional(),
  stage: z.string().optional(),
  item_color: z.string().optional(),
  vendor_name: z.string().optional(),
  specifications: z.string().optional(),
  uom_id: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  amount: z.coerce.number().min(0).default(0),
  is_general_stock: z.boolean().default(false),
});

export const processingPpmInputSchema = z.object({
  record_type: z.enum(PROCESSING_PPM_RECORD_TYPES).default("processing"),
  ppm_date: z.string().min(1, "Date is required"),
  department_id: z.string().min(1, "Department is required"),
  requisitioner_id: z.string().min(1, "Requisitioner is required"),
  customer_id: z.string().optional(),
  sales_order_id: z.string().optional(),
  group_no: z.string().min(1, "SQ No is required"),
  group_description: z.string().optional(),
  to_location_id: z.string().min(1, "Location is required"),
  to_department_id: z.string().min(1, "To Department is required"),
  to_contact_id: z.string().min(1, "To Contact is required"),
  overhead_pct: z.coerce.number().min(0).default(0),
  remarks: z.string().optional(),
  location_id: z.string().optional(),
  items: z.array(processingPpmItemSchema).min(1, "At least one item is required"),
  yarns: z.array(processingPpmYarnSchema).default([]),
});

export type ProcessingPpmInput = z.infer<typeof processingPpmInputSchema>;

// --- Purchase PPM ---

export const purchasePpmSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
});

export const purchasePpmItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_class_name: z.string().optional(),
  category_name: z.string().optional(),
  description: z.string().optional(),
  uom_id: z.string().optional(),
  is_approval_required: z.boolean().default(false),
  is_size_wise: z.boolean().default(false),
  required_date: z.string().optional(),
  qty: z.coerce.number().min(0).default(0),
  wt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  po_value: z.coerce.number().min(0).default(0),
  sizes: z.array(purchasePpmSizeSchema).default([]),
});

export const purchasePpmInputSchema = z.object({
  record_type: z.enum(PURCHASE_PPM_RECORD_TYPES).default("purchase"),
  ppm_date: z.string().min(1, "Date is required"),
  department_id: z.string().min(1, "Department is required"),
  requisitioner_id: z.string().min(1, "Requisitioner is required"),
  customer_id: z.string().min(1, "Customer is required"),
  sales_order_id: z.string().optional(),
  group_no: z.string().min(1, "SQ/Group No is required"),
  group_description: z.string().optional(),
  to_department_id: z.string().min(1, "To Department is required"),
  to_contact_id: z.string().min(1, "To Contact is required"),
  overhead_pct: z.coerce.number().min(0).default(0),
  remarks: z.string().optional(),
  location_id: z.string().optional(),
  items: z.array(purchasePpmItemSchema).min(1, "At least one item is required"),
});

export type PurchasePpmInput = z.infer<typeof purchasePpmInputSchema>;

// --- PPM Cancel ---

export const ppmCancelSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  ppm_qty: z.coerce.number().min(0).default(0),
  ppm_wt: z.coerce.number().min(0).default(0),
  cancel_qty: z.coerce.number().min(0).default(0),
  cancel_wt: z.coerce.number().min(0).default(0),
});

export const ppmCancelItemSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_class_name: z.string().optional(),
  category_name: z.string().optional(),
  description: z.string().optional(),
  uom_id: z.string().optional(),
  ppm_qty: z.coerce.number().min(0).default(0),
  ppm_wt: z.coerce.number().min(0).default(0),
  cancel_qty: z.coerce.number().min(0).default(0),
  cancel_wt: z.coerce.number().min(0).default(0),
  is_size_wise: z.boolean().default(false),
  sizes: z.array(ppmCancelSizeSchema).default([]),
});

export const ppmCancelInputSchema = z.object({
  cancel_type: z.enum(CANCEL_TYPES).default("B"),
  cancel_date: z.string().min(1, "Date is required"),
  customer_id: z.string().min(1, "Customer is required"),
  ppm_id: z.string().min(1, "PPM No is required"),
  ppm_date: z.string().optional(),
  group_no: z.string().optional(),
  group_description: z.string().optional(),
  location_id: z.string().optional(),
  items: z.array(ppmCancelItemSchema).default([]),
});

export type PpmCancelInput = z.infer<typeof ppmCancelInputSchema>;

// --- PPM Completion ---

export const ppmCompletionInputSchema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  customer_id: z.string().min(1, "Customer is required"),
  ppm_id: z.string().min(1, "PPM No is required"),
  group_no: z.string().optional(),
  group_description: z.string().optional(),
  notes: z.string().optional(),
  location_id: z.string().optional(),
});

export type PpmCompletionInput = z.infer<typeof ppmCompletionInputSchema>;

// --- Garment PPM Cancellation ---

export const garmentPpmCancelSizeSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_size: z.string().optional(),
  wo_qty: z.coerce.number().min(0).default(0),
  received_qty: z.coerce.number().min(0).default(0),
  cancel_qty: z.coerce.number().min(0).default(0),
});

export const garmentPpmCancelComboSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  item_color: z.string().optional(),
  wo_qty: z.coerce.number().min(0).default(0),
  received_qty: z.coerce.number().min(0).default(0),
  cancel_qty: z.coerce.number().min(0).default(0),
  sizes: z.array(garmentPpmCancelSizeSchema).default([]),
});

export const garmentPpmCancelCoordinateSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  coordinate: z.string().optional(),
});

export const garmentPpmCancelStyleSchema = z.object({
  id: z.string().optional(),
  sno: z.coerce.number().int().min(0),
  style_ref_no: z.string().optional(),
  style_no: z.string().optional(),
  article_no: z.string().optional(),
  sc_no: z.string().optional(),
  order_no: z.string().optional(),
  uom_id: z.string().optional(),
  cancel_qty: z.coerce.number().min(0).default(0),
  coordinates: z.array(garmentPpmCancelCoordinateSchema).default([]),
  combos: z.array(garmentPpmCancelComboSchema).default([]),
});

export const garmentPpmCancellationInputSchema = z.object({
  cancel_date: z.string().min(1, "Date is required"),
  garment_ppm_id: z.string().min(1, "PPM is required"),
  ppm_code: z.string().optional(),
  customer_name: z.string().optional(),
  description: z.string().optional(),
  location_id: z.string().optional(),
  styles: z.array(garmentPpmCancelStyleSchema).default([]),
});

export type GarmentPpmCancellationInput = z.infer<typeof garmentPpmCancellationInputSchema>;
