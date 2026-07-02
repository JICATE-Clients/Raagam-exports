import { z } from "zod";

// re-use fabric vocab from sales (same domain)
export { FABRIC_TYPES, FABRIC_SUBTYPES } from "@/lib/sales/types";
import { FABRIC_TYPES, FABRIC_SUBTYPES } from "@/lib/sales/types";

export const BOM_STATUSES = ["draft", "final"] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

export const MATERIAL_CATEGORIES = [
  "sewing_accessory",
  "packing_accessory",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  sewing_accessory: "Sewing Accessory",
  packing_accessory: "Packing Accessory",
};

export const QUANTITY_BASES = ["nos", "moq"] as const;
export type QuantityBasis = (typeof QUANTITY_BASES)[number];

export const BUDGET_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_LINE_SOURCES = ["fabric", "material", "other"] as const;
export type BudgetLineSource = (typeof BUDGET_LINE_SOURCES)[number];

// ---------- interfaces ----------
export interface FabricBom {
  id: string;
  sales_order_id: string;
  style_id: string | null;
  fabric_type: (typeof FABRIC_TYPES)[number] | null;
  fabric_subtype: (typeof FABRIC_SUBTYPES)[number] | null;
  status: BomStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricBomComponent {
  id: string;
  fabric_bom_id: string;
  component_name: string;
  color: string | null;
  size: string | null;
  diameter: string | null;
  gsm: number | null;
  consumption: number;
  uom_id: string | null;
  process_loss_pct: number;
  net_consumption: number;
  sort_order: number;
}

export interface FabricBomProcess {
  id: string;
  fabric_bom_id: string;
  sequence: number;
  process_name: string;
  process_loss_pct: number;
  notes: string | null;
}

export interface MaterialBom {
  id: string;
  sales_order_id: string;
  status: BomStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialBomItem {
  id: string;
  material_bom_id: string;
  category: MaterialCategory;
  item_id: string | null;
  description: string;
  attribute: string | null;
  uom_id: string | null;
  quantity_basis: QuantityBasis;
  quantity_nos: number;
  moq: number | null;
  unit_cost: number;
  requires_processing: boolean;
  processing_note: string | null;
  sort_order: number;
}

export interface Budget {
  id: string;
  code: string | null;
  name: string;
  is_grouped: boolean;
  status: BudgetStatus;
  currency_code: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  sales_order_id: string | null;
  source: BudgetLineSource;
  description: string;
  quantity: number;
  unit_cost: number;
  amount: number;
  sort_order: number;
}

// ---------- input schemas ----------
export const fabricBomInput = z.object({
  sales_order_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  fabric_type: z.enum(FABRIC_TYPES).optional().nullable(),
  fabric_subtype: z.enum(FABRIC_SUBTYPES).optional().nullable(),
  status: z.enum(BOM_STATUSES).default("draft"),
  notes: z.string().optional().nullable(),
});
export type FabricBomInput = z.infer<typeof fabricBomInput>;

export const fabricComponentInput = z.object({
  component_name: z.string().min(1),
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  diameter: z.string().optional().nullable(),
  gsm: z.coerce.number().nonnegative().optional().nullable(),
  consumption: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  process_loss_pct: z.coerce.number().min(0).max(100).default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type FabricComponentInput = z.infer<typeof fabricComponentInput>;

export const fabricProcessInput = z.object({
  sequence: z.coerce.number().int().default(0),
  process_name: z.string().min(1),
  process_loss_pct: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional().nullable(),
});
export type FabricProcessInput = z.infer<typeof fabricProcessInput>;

export const materialBomInput = z.object({
  sales_order_id: z.string().uuid(),
  status: z.enum(BOM_STATUSES).default("draft"),
  notes: z.string().optional().nullable(),
});
export type MaterialBomInput = z.infer<typeof materialBomInput>;

export const materialItemInput = z.object({
  category: z.enum(MATERIAL_CATEGORIES).default("sewing_accessory"),
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  attribute: z.string().optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  quantity_basis: z.enum(QUANTITY_BASES).default("nos"),
  quantity_nos: z.coerce.number().nonnegative().default(0),
  moq: z.coerce.number().nonnegative().optional().nullable(),
  unit_cost: z.coerce.number().nonnegative().default(0),
  requires_processing: z.boolean().default(false),
  processing_note: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type MaterialItemInput = z.infer<typeof materialItemInput>;

export const budgetInput = z.object({
  name: z.string().min(1),
  is_grouped: z.boolean().default(false),
  currency_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sales_order_ids: z.array(z.string().uuid()).default([]),
});
export type BudgetInput = z.infer<typeof budgetInput>;

export const budgetLineInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  source: z.enum(BUDGET_LINE_SOURCES).default("other"),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  unit_cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetLineInput = z.infer<typeof budgetLineInput>;

// ---------- computations ----------
/** Gross-up consumption by process loss: net = gross * (1 + loss%). */
export function netConsumption(consumption: number, lossPct: number): number {
  return consumption * (1 + lossPct / 100);
}

/** Effective purchase qty: MOQ when basis is 'moq' (and MOQ set), else nos. */
export function effectiveMaterialQty(
  item: Pick<MaterialBomItem, "quantity_basis" | "quantity_nos" | "moq">,
): number {
  return item.quantity_basis === "moq" && item.moq != null
    ? item.moq
    : item.quantity_nos;
}

export function lineAmount(quantity: number, unitCost: number): number {
  return quantity * unitCost;
}

// ============================================================================
// Shortages (Planning ▸ Shortage / Shortages-to-approve / Garment Shortage)
// Additive sub-module — see migration 0020.
// ============================================================================
export const SHORTAGE_KINDS = ["material", "garment"] as const;
export type ShortageKind = (typeof SHORTAGE_KINDS)[number];
export const SHORTAGE_KIND_LABELS: Record<ShortageKind, string> = {
  material: "Material",
  garment: "Garment",
};

export const SHORTAGE_STATUSES = [
  "open",
  "submitted",
  "approved",
  "rejected",
  "resolved",
] as const;
export type ShortageStatus = (typeof SHORTAGE_STATUSES)[number];
export const SHORTAGE_STATUS_LABELS: Record<ShortageStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  resolved: "Resolved",
};

export interface MaterialShortage {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  item_id: string | null;
  kind: ShortageKind;
  description: string;
  uom_id: string | null;
  required_qty: number;
  available_qty: number;
  shortage_qty: number;
  status: ShortageStatus;
  reason: string | null;
  resolution_note: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export const shortageInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  kind: z.enum(SHORTAGE_KINDS).default("material"),
  description: z.string().min(1),
  uom_id: z.string().uuid().optional().nullable(),
  required_qty: z.coerce.number().nonnegative().default(0),
  available_qty: z.coerce.number().nonnegative().default(0),
  reason: z.string().optional().nullable(),
});
export type ShortageInput = z.infer<typeof shortageInput>;

/** Shortage quantity is the positive gap between required and available. */
export function shortageQty(required: number, available: number): number {
  return Math.max(required - available, 0);
}

// ============================================================================
// Shipment Plans (Planning ▸ Create Shipment plan) — additive; see 0021.
// Distinct from the Logistics `shipments` execution register.
// ============================================================================
export const SHIPMENT_PLAN_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type ShipmentPlanStatus = (typeof SHIPMENT_PLAN_STATUSES)[number];
export const SHIPMENT_PLAN_STATUS_LABELS: Record<ShipmentPlanStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export interface ShipmentPlan {
  id: string;
  code: string | null;
  name: string;
  buyer_id: string | null;
  planned_date: string | null;
  status: ShipmentPlanStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentPlanOrder {
  shipment_plan_id: string;
  sales_order_id: string;
  planned_qty: number;
}

export const shipmentPlanInput = z.object({
  name: z.string().min(1),
  buyer_id: z.string().uuid().optional().nullable(),
  planned_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type ShipmentPlanInput = z.infer<typeof shipmentPlanInput>;

export const shipmentPlanOrderInput = z.object({
  sales_order_id: z.string().uuid(),
  planned_qty: z.coerce.number().nonnegative().default(0),
});
export type ShipmentPlanOrderInput = z.infer<typeof shipmentPlanOrderInput>;

// ============================================================================
// Amendments — shared draft → submitted → approved/rejected status vocab.
// Budget Amendments (0022) + BOM Amendments (0023). Additive sub-modules.
// ============================================================================
export const AMENDMENT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];
export const AMENDMENT_STATUS_LABELS: Record<AmendmentStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

// ---------- Budget Amendments (Planning ▸ Budget Amendment / to approve) ----------
export interface BudgetAmendment {
  id: string;
  code: string | null;
  budget_id: string;
  previous_total: number;
  revised_total: number;
  reason: string;
  status: AmendmentStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export const budgetAmendmentInput = z.object({
  budget_id: z.string().uuid(),
  revised_total: z.coerce.number().nonnegative(),
  reason: z.string().min(1),
});
export type BudgetAmendmentInput = z.infer<typeof budgetAmendmentInput>;

// ---------- BOM Amendments (Planning ▸ Fabric/Material BOM Amendment) ----------
export const BOM_KINDS = ["fabric", "material"] as const;
export type BomKind = (typeof BOM_KINDS)[number];
export const BOM_KIND_LABELS: Record<BomKind, string> = {
  fabric: "Fabric BOM",
  material: "Material BOM",
};

export interface BomAmendment {
  id: string;
  code: string | null;
  bom_kind: BomKind;
  fabric_bom_id: string | null;
  material_bom_id: string | null;
  sales_order_id: string | null;
  change_summary: string;
  reason: string | null;
  status: AmendmentStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export const bomAmendmentInput = z.object({
  bom_kind: z.enum(BOM_KINDS),
  fabric_bom_id: z.string().uuid().optional().nullable(),
  material_bom_id: z.string().uuid().optional().nullable(),
  sales_order_id: z.string().uuid().optional().nullable(),
  change_summary: z.string().min(1),
  reason: z.string().optional().nullable(),
});
export type BomAmendmentInput = z.infer<typeof bomAmendmentInput>;

// ============================================================================
// SQ Notes & Allocation (0025)
// ============================================================================
export const SQ_STATUSES = ["draft", "allocated", "cancelled"] as const;
export type SqStatus = (typeof SQ_STATUSES)[number];
export const SQ_STATUS_LABELS: Record<SqStatus, string> = {
  draft: "Draft",
  allocated: "Allocated",
  cancelled: "Cancelled",
};
export interface SqNote {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  buyer_id: string | null;
  description: string;
  status: SqStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface SqAllocation {
  id: string;
  sq_note_id: string;
  item_id: string | null;
  description: string;
  allocated_qty: number;
  uom_id: string | null;
  sort_order: number;
}
export const sqNoteInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  buyer_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  notes: z.string().optional().nullable(),
});
export type SqNoteInput = z.infer<typeof sqNoteInput>;
export const sqAllocationInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  allocated_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type SqAllocationInput = z.input<typeof sqAllocationInput>;

// ============================================================================
// BOM for Internal Work Orders (0026) — reuses BOM_STATUSES (draft/final)
// ============================================================================
export interface IwoBom {
  id: string;
  code: string | null;
  iwo_id: string;
  status: BomStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface IwoBomItem {
  id: string;
  iwo_bom_id: string;
  item_id: string | null;
  description: string;
  quantity: number;
  uom_id: string | null;
  unit_cost: number;
  sort_order: number;
}
export const iwoBomItemInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  unit_cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type IwoBomItemInput = z.input<typeof iwoBomItemInput>;

// ============================================================================
// Purchase Process Allocation (0027)
// ============================================================================
export const PROCESS_ALLOC_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type ProcessAllocStatus = (typeof PROCESS_ALLOC_STATUSES)[number];
export const PROCESS_ALLOC_STATUS_LABELS: Record<ProcessAllocStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};
export interface ProcessAllocation {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  process_name: string;
  vendor_id: string | null;
  allocated_qty: number;
  uom_id: string | null;
  rate: number;
  status: ProcessAllocStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const processAllocationInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  process_name: z.string().min(1),
  vendor_id: z.string().uuid().optional().nullable(),
  allocated_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
export type ProcessAllocationInput = z.infer<typeof processAllocationInput>;

// ============================================================================
// Material Excess Order & Receipt (0028)
// ============================================================================
export const MATERIAL_EXCESS_STATUSES = ["open", "received", "closed", "cancelled"] as const;
export type MaterialExcessStatus = (typeof MATERIAL_EXCESS_STATUSES)[number];
export const MATERIAL_EXCESS_STATUS_LABELS: Record<MaterialExcessStatus, string> = {
  open: "Open",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
};
export interface MaterialExcess {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  item_id: string | null;
  description: string;
  uom_id: string | null;
  ordered_qty: number;
  received_qty: number;
  status: MaterialExcessStatus;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const materialExcessInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  uom_id: z.string().uuid().optional().nullable(),
  ordered_qty: z.coerce.number().nonnegative().default(0),
  reason: z.string().optional().nullable(),
});
export type MaterialExcessInput = z.infer<typeof materialExcessInput>;

// ============================================================================
// Issue PPM (0029)
// ============================================================================
export const PPM_STATUSES = ["draft", "issued", "received", "cancelled"] as const;
export type PpmStatus = (typeof PPM_STATUSES)[number];
export const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  received: "Received",
  cancelled: "Cancelled",
};
export interface PpmIssue {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  description: string | null;
  issue_date: string | null;
  status: PpmStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface PpmIssueLine {
  id: string;
  ppm_issue_id: string;
  item_id: string | null;
  description: string;
  issued_qty: number;
  received_qty: number;
  uom_id: string | null;
  rate: number;
  sort_order: number;
}
export const ppmIssueInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PpmIssueInput = z.infer<typeof ppmIssueInput>;
export const ppmLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  issued_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type PpmLineInput = z.input<typeof ppmLineInput>;

// ============================================================================
// Stock Completion (0030)
// ============================================================================
export const STOCK_COMPLETION_STATUSES = ["draft", "completed", "cancelled"] as const;
export type StockCompletionStatus = (typeof STOCK_COMPLETION_STATUSES)[number];
export const STOCK_COMPLETION_STATUS_LABELS: Record<StockCompletionStatus, string> = {
  draft: "Draft",
  completed: "Completed",
  cancelled: "Cancelled",
};
export interface StockCompletion {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  description: string;
  completed_qty: number;
  status: StockCompletionStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const stockCompletionInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  completed_qty: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
export type StockCompletionInput = z.infer<typeof stockCompletionInput>;

// ============================================================================
// Product Development Pipeline (0031)
// ============================================================================
export const PD_STAGES = [
  "acknowledged",
  "grouped",
  "processes_defined",
  "sample_production",
  "processing",
  "samples_to_dept",
  "dispatched",
  "packing_list",
] as const;
export type PdStage = (typeof PD_STAGES)[number];
export const PD_STAGE_LABELS: Record<PdStage, string> = {
  acknowledged: "Acknowledged",
  grouped: "Grouped",
  processes_defined: "Processes defined",
  sample_production: "Sample production",
  processing: "Processing",
  samples_to_dept: "Samples to dept",
  dispatched: "Dispatched",
  packing_list: "Packing list",
};
export const PD_STATUSES = ["open", "closed", "cancelled"] as const;
export type PdStatus = (typeof PD_STATUSES)[number];
export const PD_STATUS_LABELS: Record<PdStatus, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
};
export interface PdRequest {
  id: string;
  code: string | null;
  opportunity_id: string | null;
  buyer_id: string | null;
  title: string;
  description: string | null;
  stage: PdStage;
  status: PdStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface PdProduct {
  id: string;
  pd_request_id: string;
  style_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
}
export const pdRequestInput = z.object({
  opportunity_id: z.string().uuid().optional().nullable(),
  buyer_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
});
export type PdRequestInput = z.infer<typeof pdRequestInput>;
export const pdProductInput = z.object({
  style_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type PdProductInput = z.input<typeof pdProductInput>;

/** Next stage in the linear PD pipeline, or null if already at the end. */
export function nextPdStage(stage: PdStage): PdStage | null {
  const i = PD_STAGES.indexOf(stage);
  return i >= 0 && i < PD_STAGES.length - 1 ? PD_STAGES[i + 1] : null;
}
