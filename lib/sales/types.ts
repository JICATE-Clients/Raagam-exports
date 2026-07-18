import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const OPPORTUNITY_STAGES = [
  "enquiry",
  "costing",
  "quoted",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const FABRIC_TYPES = ["woven", "circular", "flat_knit"] as const;
export const FABRIC_SUBTYPES = ["solid", "yarn_dyed", "melange"] as const;

export const ENQUIRY_AGAINST = ["new", "repeat", "development"] as const;
export const ORDER_TYPES = ["new", "repeat"] as const;
export const DELIVERY_MODES = ["air", "sea", "courier", "road"] as const;
export const RECEIPT_MODES = ["email", "phone", "fax", "courier", "direct"] as const;
export const SHIP_MODES = ["air", "sea", "road"] as const;

/** Sample types (shared by samples + the Define Styles "Sample Type" column). */
export const SAMPLE_TYPES = ["proto", "fit", "sms", "pp", "top"] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const SAMPLE_STATUSES = [
  "requested",
  "in_progress",
  "sent",
  "approved",
  "rejected",
] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export const COST_SHEET_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "superseded",
] as const;
export type CostSheetStatus = (typeof COST_SHEET_STATUSES)[number];

export const COST_CATEGORIES = [
  "material",
  "labour",
  "overhead",
  "other",
] as const;

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function quoteStatusTone(status: QuoteStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "sent":
      return "info";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
  }
}

export interface Opportunity {
  id: string;
  code: string | null;
  buyer_id: string;
  title: string;
  season: string | null;
  stage: OpportunityStage;
  target_fob: number | null;
  currency_code: string | null;
  owner_id: string | null;
  notes: string | null;
  // Market Enquiry fields (0319)
  brand_id: string | null;
  agent_name: string | null;
  merchandiser_id: string | null;
  season_id: string | null;
  customer_department: string | null;
  customer_reference: string | null;
  enquiry_against: (typeof ENQUIRY_AGAINST)[number] | null;
  order_type: (typeof ORDER_TYPES)[number] | null;
  sample_for: string | null;
  delivery_mode: (typeof DELIVERY_MODES)[number] | null;
  delivery_to: string | null;
  receipt_mode: (typeof RECEIPT_MODES)[number] | null;
  received_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Style {
  id: string;
  opportunity_id: string;
  style_code: string | null;
  name: string;
  fabric_type: (typeof FABRIC_TYPES)[number] | null;
  fabric_subtype: (typeof FABRIC_SUBTYPES)[number] | null;
  description: string | null;
  image_url: string | null;
  // Define Styles (legacy "By Enquiry No.") extras — see migration 0268.
  action: string | null;
  sample_type: SampleType | null;
  composition: string | null;
  sample_qty: number | null;
  unit_id: string | null;
  specs: Record<string, unknown>;
  // Market Enquiry style fields (0319)
  fabric_structure: string | null;
  ship_type_id: string | null;
  ship_mode: (typeof SHIP_MODES)[number] | null;
  theme: string | null;
  expected_order_qty: number | null;
  order_qty: number | null;
  delivery_date: string | null;
  is_costing_option: boolean;
  price_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface StyleCombo {
  id: string;
  style_id: string;
  sno: number;
  combo: string;
  combo_description: string | null;
  order_qty: number | null;
  expected_order_qty: number | null;
  sizes: StyleComboSize[];
  created_at: string;
  updated_at: string;
}

export interface StyleComboSize {
  id: string;
  style_combo_id: string;
  sno: number;
  garment_size: string;
  order_qty: number | null;
  expected_order_qty: number | null;
}

export interface StyleSize {
  id: string;
  style_id: string;
  sno: number;
  garment_size: string;
  order_qty: number | null;
  expected_order_qty: number | null;
}

export interface CostSheet {
  id: string;
  opportunity_id: string;
  style_id: string | null;
  version: number;
  status: CostSheetStatus;
  currency_code: string | null;
  target_fob: number | null;
  computed_fob: number;
  margin_pct: number | null;
  notes: string | null;
  parent_cost_sheet_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostSheetItem {
  id: string;
  cost_sheet_id: string;
  category: (typeof COST_CATEGORIES)[number];
  description: string;
  quantity: number;
  uom_id: string | null;
  unit_cost: number;
  amount: number;
  sort_order: number;
}

export interface Quote {
  id: string;
  code: string | null;
  opportunity_id: string;
  cost_sheet_id: string | null;
  buyer_id: string;
  fob_price: number;
  currency_code: string | null;
  quantity: number | null;
  incoterm: string | null;
  include_sample: boolean;
  status: QuoteStatus;
  valid_until: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sample {
  id: string;
  code: string | null;
  opportunity_id: string;
  style_id: string | null;
  quote_id: string | null;
  type: SampleType;
  status: SampleStatus;
  // Legacy "By Sample No." fields — see migration 0272.
  sample_qty: number | null;
  unit_id: string | null;
  delivery_date: string | null;
  customer_reference: string | null;
  dispatched_at: string | null;
  courier_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const sampleInput = z.object({
  opportunity_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  quote_id: z.string().uuid().optional().nullable(),
  type: z.enum(SAMPLE_TYPES),
  status: z.enum(SAMPLE_STATUSES).default("requested"),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
  courier_ref: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SampleInput = z.infer<typeof sampleInput>;

// ---------- input schemas ----------
export const opportunityInput = z.object({
  buyer_id: z.string().uuid(),
  title: z.string().min(1),
  season: z.string().optional().nullable(),
  stage: z.enum(OPPORTUNITY_STAGES).default("enquiry"),
  target_fob: z.coerce.number().nonnegative().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Market Enquiry fields
  brand_id: z.string().uuid().optional().nullable(),
  agent_name: z.string().optional().nullable(),
  merchandiser_id: z.string().uuid().optional().nullable(),
  season_id: z.string().uuid().optional().nullable(),
  customer_department: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
  enquiry_against: z.enum(ENQUIRY_AGAINST).optional().nullable(),
  order_type: z.enum(ORDER_TYPES).optional().nullable(),
  sample_for: z.string().optional().nullable(),
  delivery_mode: z.enum(DELIVERY_MODES).optional().nullable(),
  delivery_to: z.string().optional().nullable(),
  receipt_mode: z.enum(RECEIPT_MODES).optional().nullable(),
  received_date: z.string().optional().nullable(),
});
export type OpportunityInput = z.infer<typeof opportunityInput>;

/**
 * Bulk "Create opportunities — By Customer": pick many buyers, create one
 * opportunity each. Title/currency are derived per-buyer server-side; `season`
 * (optional) is applied to every created opportunity.
 */
export const bulkOpportunityInput = z.object({
  buyer_ids: z.array(z.string().uuid()).min(1),
  season: z.string().optional().nullable(),
});
export type BulkOpportunityInput = z.infer<typeof bulkOpportunityInput>;

export const styleComboSizeInput = z.object({
  garment_size: z.string().min(1),
  order_qty: z.coerce.number().optional().nullable(),
  expected_order_qty: z.coerce.number().optional().nullable(),
});

export const styleComboInput = z.object({
  combo: z.string().min(1),
  combo_description: z.string().optional().nullable(),
  order_qty: z.coerce.number().optional().nullable(),
  expected_order_qty: z.coerce.number().optional().nullable(),
  sizes: z.array(styleComboSizeInput).default([]),
});

export const styleSizeInput = z.object({
  garment_size: z.string().min(1),
  order_qty: z.coerce.number().optional().nullable(),
  expected_order_qty: z.coerce.number().optional().nullable(),
});

export const styleInput = z.object({
  opportunity_id: z.string().uuid(),
  style_code: z.string().optional().nullable(),
  name: z.string().min(1),
  fabric_type: z.enum(FABRIC_TYPES).optional().nullable(),
  fabric_subtype: z.enum(FABRIC_SUBTYPES).optional().nullable(),
  description: z.string().optional().nullable(),
  image_url: z.string().optional().nullable(),
  // Define Styles extras
  action: z.string().optional().nullable(),
  sample_type: z.enum(SAMPLE_TYPES).optional().nullable(),
  composition: z.string().optional().nullable(),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  // Market Enquiry style fields
  fabric_structure: z.string().optional().nullable(),
  ship_type_id: z.string().uuid().optional().nullable(),
  ship_mode: z.enum(SHIP_MODES).optional().nullable(),
  theme: z.string().optional().nullable(),
  expected_order_qty: z.coerce.number().optional().nullable(),
  order_qty: z.coerce.number().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  is_costing_option: z.boolean().default(false),
  price_type: z.string().optional().nullable(),
  // Child grids
  combos: z.array(styleComboInput).default([]),
  sizes: z.array(styleSizeInput).default([]),
});
export type StyleInput = z.infer<typeof styleInput>;

/** Sales-side "Product Development Request — By Sample No." form. Writes into
 *  Planning's `pd_requests` (via admin client); extra fields added in 0270. */
export const pdRequestFormInput = z.object({
  opportunity_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  style_id: z.string().uuid().optional().nullable(),
  sample_type: z.enum(SAMPLE_TYPES).optional().nullable(),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
});
export type PdRequestFormInput = z.infer<typeof pdRequestFormInput>;

export const costSheetItemInput = z.object({
  category: z.enum(COST_CATEGORIES).default("material"),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  unit_cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type CostSheetItemInput = z.infer<typeof costSheetItemInput>;

export const costSheetInput = z.object({
  opportunity_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  target_fob: z.coerce.number().nonnegative().optional().nullable(),
  margin_pct: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(costSheetItemInput).default([]),
});
export type CostSheetInput = z.infer<typeof costSheetInput>;

export const quoteInput = z.object({
  opportunity_id: z.string().uuid(),
  cost_sheet_id: z.string().uuid().optional().nullable(),
  buyer_id: z.string().uuid(),
  fob_price: z.coerce.number().nonnegative(),
  currency_code: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().optional().nullable(),
  incoterm: z.string().default("FOB"),
  include_sample: z.boolean().default(false),
  valid_until: z.string().optional().nullable(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

/** FOB = sum of cost-sheet item amounts (amount = quantity * unit_cost). */
export function computeFob(
  items: Pick<CostSheetItemInput, "quantity" | "unit_cost">[],
): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
}

// =========================================================================
// IOC Costing Engine types (migration 0320)
// =========================================================================

export const COSTING_TYPES = ["simple", "ioc"] as const;
export const COSTING_FOR = ["sample", "production"] as const;
export const SAMPLE_FOR = ["fabric", "garment"] as const;
export const IOC_SAMPLE_TYPES = ["normal", "assorted"] as const;
export const CONSUMPTION_FOR = ["F", "T", "G", "M", "R"] as const;
export type ConsumptionFor = (typeof CONSUMPTION_FOR)[number];

export const CONSUMPTION_LABELS: Record<ConsumptionFor, string> = {
  F: "Fabric",
  T: "Trims",
  G: "Garment Process",
  M: "CMT",
  R: "Rejection",
};

export interface IocStyleCost {
  id: string;
  cost_sheet_id: string;
  sno: number;
  style_id: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  uom_id: string | null;
  order_qty: number | null;
  wt_per_garment: number | null;
  fabric_cost: number;
  trims_cost: number;
  cmt_cost: number;
  garment_process_cost: number;
  pack_cost: number;
  rejection_cost: number;
  expenses_production: number;
  expenses_others: number;
  expenses_total: number;
  expenses_revenue: number;
  profit_loss_garment: number;
  profit_loss_pct: number;
}

export interface IocConsDetail {
  id: string;
  style_cost_id: string;
  consumption_for: ConsumptionFor;
  sno: number;
  category_name: string | null;
  item_description: string | null;
  process_name: string | null;
  coordinate: string | null;
  uom_id: string | null;
  gsm: number | null;
  fab_width: number | null;
  no_of_items_for_pcs: number | null;
  no_of_pcs_for_items: number | null;
  rate_type: string | null;
  cons_qty: number;
  cons_wt: number;
  rate: number;
  cost: number;
  calculated_cost: number;
  additional_cost: number;
  is_direct_rate: boolean;
  is_assort_colorwise: boolean;
  details: string | null;
}

export interface IocCmtOperation {
  id: string;
  cons_detail_id: string;
  sno: number;
  operation_name: string;
  is_sizewise: boolean;
  rate: number;
  cost: number;
  sizes: IocCmtSize[];
}

export interface IocCmtSize {
  id: string;
  cmt_operation_id: string;
  item_size: string;
  qty: number;
  rate: number;
  cost: number;
}

export interface IocFabricRate {
  id: string;
  cost_sheet_id: string;
  sno: number;
  fabric_description: string | null;
  structure_name: string | null;
  composition_name: string | null;
  struct_type: string | null;
  fabric_type: string | null;
  fabric_sub_type: string | null;
  gsm: number | null;
  is_direct_rate: boolean;
  style_ref_no: string | null;
  style_no: string | null;
  fabric_rate_without_loss: number;
  process_loss_pct: number;
  process_loss_rate: number;
  fabric_rate: number;
  margin_pct: number;
  margin_cost: number;
  fob_inr: number;
  other_expenses_cost: number;
  gross_cost: number;
  is_assort_colorwise: boolean;
  process_rates: IocFabricProcessRate[];
  colors: IocFabricRateColor[];
}

export interface IocFabricProcessRate {
  id: string;
  fabric_rate_id: string;
  sno: number;
  process_name: string | null;
  process_rate: number;
  uom_id: string | null;
  is_direct_rate: boolean;
  details: IocFabricProcessDetail[];
}

export interface IocFabricProcessDetail {
  id: string;
  process_rate_id: string;
  sno: number;
  color_group: string | null;
  mixing_item_details: string | null;
  uom_id: string | null;
  rate: number;
  mixing_pct: number;
  qty: number;
  cost: number;
}

export interface IocFabricRateColor {
  id: string;
  fabric_rate_id: string;
  sno: number;
  color_name: string | null;
  percentage: number;
}

export interface IocOtherExpense {
  id: string;
  cost_sheet_id: string;
  sno: number;
  cost_short_name: string | null;
  cost_description: string | null;
  item_description: string | null;
  type_for: string | null;
  rate_type: string | null;
  cons_qty: number;
  uom_id: string | null;
  rate: number;
  cost: number;
  style_details: IocExpenseStyle[];
}

export interface IocExpenseStyle {
  id: string;
  expense_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  uom_id: string | null;
  order_qty: number | null;
  qty: number | null;
  rate: number;
  cost: number;
}

export interface IocBudget {
  id: string;
  cost_sheet_id: string;
  sno: number;
  cost_short_name: string | null;
  cost_description: string | null;
  cost: number;
  by_us_cost: number;
  by_vendor_cost: number;
}

/** Full IOC costing data — loaded when viewing/editing an IOC cost sheet. */
export interface IocCostingData {
  style_costs: IocStyleCost[];
  fabric_rates: IocFabricRate[];
  other_expenses: IocOtherExpense[];
  budgets: IocBudget[];
}
