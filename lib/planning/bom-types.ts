import { z } from "zod";

// ============================================================================
// Material / Production BOM  (FrmProd_BOM — 3 tabs for Raagam company 38)
// Tab 1: "Cloths" — Products grid (accessories, materials, trims)
// Tab 2: "Yarn Process" — Yarn process sequences
// Tab 3: "Fabric Process" — Fabric process sequences
// NOTE: Fabrics & Programs tabs are company 39 only — NOT for Raagam.
// ============================================================================

export const BOM_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

// --- ValueList enums from VB.NET source ---

export const ITEM_SUB_TYPES = ["solid", "yarn_dyed", "melange"] as const;
export type ItemSubType = (typeof ITEM_SUB_TYPES)[number];
export const ITEM_SUB_TYPE_LABELS: Record<ItemSubType, string> = {
  solid: "Solid",
  yarn_dyed: "Yarn Dyed",
  melange: "Melange",
};

export const WARP_WEFT = ["warp", "weft"] as const;
export type WarpWeft = (typeof WARP_WEFT)[number];
export const WARP_WEFT_LABELS: Record<WarpWeft, string> = {
  warp: "Warp",
  weft: "Weft",
};

export const YARN_REQD_FORMS = ["hank", "cheese", "both"] as const;
export type YarnReqdForm = (typeof YARN_REQD_FORMS)[number];
export const YARN_REQD_FORM_LABELS: Record<YarnReqdForm, string> = {
  hank: "Hank",
  cheese: "Cheese",
  both: "Hank/Cheese",
};

export const PROCESS_STAGES_YARN = ["grey", "dyed"] as const;
export const PROCESS_STAGES_FABRIC = ["grey", "dyed", "wash", "print"] as const;
export type ProcessStageYarn = (typeof PROCESS_STAGES_YARN)[number];
export type ProcessStageFabric = (typeof PROCESS_STAGES_FABRIC)[number];

export const LOSS_FOR_YARN = ["process", "color", "type", "color_type"] as const;
export const LOSS_FOR_FABRIC = ["process", "color", "print"] as const;
export type LossForYarn = (typeof LOSS_FOR_YARN)[number];
export type LossForFabric = (typeof LOSS_FOR_FABRIC)[number];
export const LOSS_FOR_YARN_LABELS: Record<LossForYarn, string> = {
  process: "Process wise",
  color: "Color wise",
  type: "Type wise",
  color_type: "Color-Type wise",
};
export const LOSS_FOR_FABRIC_LABELS: Record<LossForFabric, string> = {
  process: "Process wise",
  color: "Color wise",
  print: "Print wise",
};

export const BOM_FOR_TYPES = ["itemwise", "colorwise", "sizewise", "colorwise_sizewise"] as const;
export type BomForType = (typeof BOM_FOR_TYPES)[number];
export const BOM_FOR_TYPE_LABELS: Record<BomForType, string> = {
  itemwise: "Itemwise",
  colorwise: "Colorwise",
  sizewise: "Sizewise",
  colorwise_sizewise: "Colorwise-Sizewise",
};

export const SUPPLY_TYPES = ["customer", "nominated", "recommended", "others"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];
export const SUPPLY_TYPE_LABELS: Record<SupplyType, string> = {
  customer: "Customer",
  nominated: "Nominated",
  recommended: "Recommended",
  others: "Others",
};

export const AVAILABILITY_TYPES = ["stock", "made_to_order", "special"] as const;
export type AvailabilityType = (typeof AVAILABILITY_TYPES)[number];

export const DUE_TO_TYPES = ["by_us", "by_party"] as const;
export type DueTo = (typeof DUE_TO_TYPES)[number];
export const DUE_TO_LABELS: Record<DueTo, string> = {
  by_us: "By Us",
  by_party: "By Party",
};

export const TRANSFER_STAGES = ["grey", "dyed", "print", "wash", "finished"] as const;
export type TransferStage = (typeof TRANSFER_STAGES)[number];

export const DYE_COLOR_TYPES = ["yarn_dye", "fabric_dye", "print"] as const;
export type DyeColorType = (typeof DYE_COLOR_TYPES)[number];

export const PROCESS_TYPES = ["component", "garment"] as const;
export type GarmentBomProcessType = (typeof PROCESS_TYPES)[number];

export const PROCESS_SEQ_TYPES = ["yarn", "fabric"] as const;
export type ProcessSeqType = (typeof PROCESS_SEQ_TYPES)[number];

// ============================================================================
// Material BOM interfaces
// ============================================================================

export interface MaterialBom {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  order_no: string | null;
  oc_no: string | null;
  status: BomStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialBomProduct {
  id: string;
  material_bom_id: string;
  sno: number;
  item_id: string | null;
  uom_id: string | null;
  order_qty: number;
  excess_pct: number;
  extra_qty: number;
  additional_qty: number;
  total_qty: number;
  rate: number;
  inr_rate: number;
  total_value: number;
  description: string | null;
  yarn_reqd_form: string | null;
  sort_order: number;
}

export interface MaterialBomCloth {
  id: string;
  fabric_id: string;
  sno: number;
  cloth_name: string | null;
  fabric_short_name: string | null;
  uom_id: string | null;
  yarn_short_name: string | null;
  shade_id: string | null;
  warp_weft: string | null;
  yarn_reqd_form: string | null;
  is_doubling_yarn: boolean;
  sort_order: number;
}

export interface MaterialBomProcessSequence {
  id: string;
  material_bom_id: string;
  process_type: ProcessSeqType;
  sno: number;
  item_id: string | null;
  item_process_type: string | null;
  process_seq_name: string | null;
  sort_order: number;
}

export interface MaterialBomProcessStage {
  id: string;
  sequence_id: string;
  sno: number;
  stage: string | null;
  process_name: string | null;
  loss_for: string | null;
  loss_pct: number;
  description: string | null;
  sort_order: number;
}

// ============================================================================
// Fabric BOM interfaces
// ============================================================================

export interface FabricBom {
  id: string;
  code: string | null;
  style_id: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  amendment_no: number;
  revision_no: number;
  catalogue_no: string | null;
  description: string | null;
  status: BomStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Garment BOM interfaces
// ============================================================================

export interface GarmentBom {
  id: string;
  code: string | null;
  style_id: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  order_no: string | null;
  oc_no: string | null;
  amendment_no: number;
  reason: string | null;
  task_owner_id: string | null;
  status: BomStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Accessory BOM interfaces
// ============================================================================

export interface AccessoryBom {
  id: string;
  code: string | null;
  bom_type: "purchased" | "in_factory";
  sales_order_id: string | null;
  customer_id: string | null;
  style_id: string | null;
  order_no: string | null;
  group_no: string | null;
  amendment_no: number;
  reason: string | null;
  task_owner_id: string | null;
  status: BomStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// BOM Shortage interfaces
// ============================================================================

export interface BomShortage {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  style_id: string | null;
  group_no: string | null;
  order_no: string | null;
  req_no: string | null;
  req_date: string;
  required_date: string | null;
  department_id: string | null;
  employee_id: string | null;
  ppm_ref: string | null;
  against_ppm: boolean;
  division_id: string | null;
  location_id: string | null;
  update_previous_boms: boolean;
  status: BomStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BomShortageItem {
  id: string;
  shortage_id: string;
  sno: number;
  item_class: string | null;
  description: string | null;
  uom_id: string | null;
  qty: number;
  mtr: number;
  wt: number;
  rate: number;
  reason: string | null;
  due_to: DueTo | null;
  due_to_vendor_id: string | null;
  due_to_employee_id: string | null;
  debit_required: boolean;
  remarks: string | null;
  sort_order: number;
}

// ============================================================================
// BOM Transfer interfaces
// ============================================================================

export interface BomTransfer {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  group_no: string | null;
  transfer_from: string | null;
  transfer_to: string | null;
  location_id: string | null;
  status: "draft" | "submitted" | "approved";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BomTransferItem {
  id: string;
  transfer_id: string;
  sno: number;
  item_class: string | null;
  stage: TransferStage | null;
  description: string | null;
  process_name: string | null;
  uom_id: string | null;
  reqd_qty: number;
  reqd_wt: number;
  xfr_qty: number;
  xfr_wt: number;
  xfr_qty_with_loss: number;
  xfr_wt_with_loss: number;
  sort_order: number;
}

// ============================================================================
// Zod schemas for form input
// ============================================================================

export const materialBomInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  order_no: z.string().optional().nullable(),
  oc_no: z.string().optional().nullable(),
});
export type MaterialBomInput = z.infer<typeof materialBomInput>;

export const materialBomProductInput = z.object({
  material_bom_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  item_id: z.string().uuid().optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  order_qty: z.coerce.number().nonnegative().default(0),
  excess_pct: z.coerce.number().nonnegative().default(0),
  extra_qty: z.coerce.number().nonnegative().default(0),
  additional_qty: z.coerce.number().nonnegative().default(0),
  total_qty: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  inr_rate: z.coerce.number().nonnegative().default(0),
  total_value: z.coerce.number().nonnegative().default(0),
  description: z.string().max(250).optional().nullable(),
  yarn_reqd_form: z.enum(YARN_REQD_FORMS).optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type MaterialBomProductInput = z.infer<typeof materialBomProductInput>;

export const bomShortageInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  style_id: z.string().uuid().optional().nullable(),
  group_no: z.string().optional().nullable(),
  order_no: z.string().optional().nullable(),
  req_no: z.string().optional().nullable(),
  req_date: z.string(),
  required_date: z.string().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  employee_id: z.string().uuid().optional().nullable(),
  ppm_ref: z.string().optional().nullable(),
  against_ppm: z.boolean().default(false),
  division_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  update_previous_boms: z.boolean().default(false),
});
export type BomShortageInput = z.infer<typeof bomShortageInput>;

export const bomTransferInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  group_no: z.string().optional().nullable(),
  transfer_from: z.string().optional().nullable(),
  transfer_to: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
});
export type BomTransferInput = z.infer<typeof bomTransferInput>;

export const bomShortageItemInput = z.object({
  shortage_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  item_class: z.string().max(100).optional().nullable(),
  description: z.string().max(250).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().nonnegative().default(0),
  mtr: z.coerce.number().nonnegative().default(0),
  wt: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  reason: z.string().max(250).optional().nullable(),
  due_to: z.enum(DUE_TO_TYPES).optional().nullable(),
  due_to_vendor_id: z.string().uuid().optional().nullable(),
  due_to_employee_id: z.string().uuid().optional().nullable(),
  debit_required: z.boolean().default(false),
  remarks: z.string().max(500).optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type BomShortageItemInput = z.infer<typeof bomShortageItemInput>;

export const bomTransferItemInput = z.object({
  transfer_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  item_class: z.string().max(100).optional().nullable(),
  stage: z.enum(TRANSFER_STAGES).optional().nullable(),
  description: z.string().max(250).optional().nullable(),
  process_name: z.string().max(100).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  reqd_qty: z.coerce.number().nonnegative().default(0),
  reqd_wt: z.coerce.number().nonnegative().default(0),
  xfr_qty: z.coerce.number().nonnegative().default(0),
  xfr_wt: z.coerce.number().nonnegative().default(0),
  xfr_qty_with_loss: z.coerce.number().nonnegative().default(0),
  xfr_wt_with_loss: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BomTransferItemInput = z.infer<typeof bomTransferItemInput>;
