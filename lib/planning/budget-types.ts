import { z } from "zod";

// ============================================================================
// SQ / PPM Budget  (FrmSQBudget — Raagam company 38)
// 6 tabs: Purchase Rates, Process Rates, CMTs, Other Expenses, Other Incomes, General
// Approval workflow: draft → submitted → approved → rejected
// ============================================================================

export const BUDGET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_TYPES = ["sq", "ppm", "amendment"] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];
export const BUDGET_TYPE_LABELS: Record<BudgetType, string> = {
  sq: "SQ",
  ppm: "PPM",
  amendment: "Amendment",
};

export const BUDGET_ENTRY_TYPES = ["A", "F", "T", "G"] as const;
export type BudgetEntryType = (typeof BUDGET_ENTRY_TYPES)[number];
export const BUDGET_ENTRY_TYPE_LABELS: Record<BudgetEntryType, string> = {
  A: "All",
  F: "Fabric",
  T: "Trims",
  G: "Garment",
};

export const PURCHASE_TYPES = ["yarn", "fabric", "accessories"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];
export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  yarn: "Yarn",
  fabric: "Fabric",
  accessories: "Accessories",
};

export const PROCESS_TYPES = ["yarn", "fabric", "accessories", "garment"] as const;
export type BudgetProcessType = (typeof PROCESS_TYPES)[number];
export const PROCESS_TYPE_LABELS: Record<BudgetProcessType, string> = {
  yarn: "Yarn",
  fabric: "Fabric",
  accessories: "Accessories",
  garment: "Garment",
};

export const OTHER_ENTRY_TYPES = ["expense", "income"] as const;
export type OtherEntryType = (typeof OTHER_ENTRY_TYPES)[number];

// ============================================================================
// Budget Header
// ============================================================================

export interface Budget {
  id: string;
  code: string | null;
  budget_type: BudgetType;
  entry_type: BudgetEntryType;
  sales_order_id: string | null;
  customer_id: string | null;
  group_no: string | null;
  group_description: string | null;
  uom_id: string | null;
  sq_qty: number;
  currency_code: string | null;
  exchange_rate: number;
  smv_rate: number;
  amendment_no: number;
  reason: string | null;
  task_owner_id: string | null;
  gross_sales_value: number;
  avg_price: number;
  sales_value: number;
  total_expense: number;
  profit_loss_value: number;
  profit_loss_pct: number;
  status: BudgetStatus;
  approved_by: string | null;
  approved_at: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Budget Purchases (Tab 1 — Purchase Rates)
// ============================================================================

export interface BudgetPurchase {
  id: string;
  budget_id: string;
  purchase_type: PurchaseType;
  sno: number;
  item_id: string | null;
  item_name: string | null;
  gsm: number | null;
  stage: string | null;
  item_type: string | null;
  item_color: string | null;
  print_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  item_process_type: string | null;
  specifications: string | null;
  uom_id: string | null;
  reqd_qty: number;
  is_foc: boolean;
  is_import: boolean;
  currency_code: string | null;
  exchange_rate: number;
  is_sizewise_rate: boolean;
  rate: number;
  inr_rate: number;
  moq: number | null;
  last_po_rate: number | null;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Budget Processes (Tab 2 — Process Rates)
// ============================================================================

export interface BudgetProcess {
  id: string;
  budget_id: string;
  process_type: BudgetProcessType;
  sno: number;
  process_id: string | null;
  process_name: string | null;
  rate_for: string | null;
  rate_for_type: string | null;
  uom_id: string | null;
  reqd_qty: number;
  is_foc: boolean;
  rate_type: string | null;
  charges: number;
  design_charges: number;
  po_value: number;
  rate: number;
  is_by_us: boolean;
  sort_order: number;
  created_at: string;
}

export interface BudgetProcessItem {
  id: string;
  process_id: string;
  sno: number;
  description: string | null;
  uom_id: string | null;
  reqd_qty: number;
  is_foc: boolean;
  charges: number;
  design_charges: number;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Budget CMTs (Tab 3 — Cut, Make & Trim)
// ============================================================================

export interface BudgetCmt {
  id: string;
  budget_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  oc_no: string | null;
  order_no: string | null;
  coordinate_name: string | null;
  order_qty: number;
  sq_qty: number;
  smvs: number;
  rate: number;
  is_flat_rate: boolean;
  sort_order: number;
  created_at: string;
}

export interface BudgetCmtOperation {
  id: string;
  cmt_id: string;
  sno: number;
  operation_name: string | null;
  is_sizewise: boolean;
  is_detailwise: boolean;
  is_colorwise: boolean;
  smvs: number;
  rate: number;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Budget Other Entries (Tab 4 & 5 — Expenses / Incomes)
// ============================================================================

export interface BudgetOtherEntry {
  id: string;
  budget_id: string;
  entry_type: OtherEntryType;
  sno: number;
  cost_description: string | null;
  description: string | null;
  type_for: string | null;
  rate_type: string | null;
  qty: number;
  uom_id: string | null;
  rate: number;
  cost: number;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Budget Heads (Tab 6 — General: Cost heads summary)
// ============================================================================

export interface BudgetHead {
  id: string;
  budget_id: string;
  sno: number;
  cost_description: string | null;
  cost: number;
  contribution_pct: number;
  cost_per_garment: number;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Budget Styles (Tab 6 — General: Per-style P&L)
// ============================================================================

export interface BudgetStyle {
  id: string;
  budget_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  oc_no: string | null;
  order_no: string | null;
  uom_id: string | null;
  order_qty: number;
  rate: number;
  wt_per_garment: number;
  revenue: number;
  expenses_fabric: number;
  expenses_production: number;
  expenses_cmt: number;
  expenses_trims: number;
  expenses_garments: number;
  expenses_packs: number;
  expenses_gar_rejection: number;
  expenses_others: number;
  expenses_total: number;
  profit_loss: number;
  profit_loss_pct: number;
  sort_order: number;
  created_at: string;
}

// ============================================================================
// Zod schemas for form input
// ============================================================================

export const budgetInput = z.object({
  budget_type: z.enum(BUDGET_TYPES).default("sq"),
  entry_type: z.enum(BUDGET_ENTRY_TYPES).default("A"),
  sales_order_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  group_no: z.string().optional().nullable(),
  group_description: z.string().max(500).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  sq_qty: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().max(10).default("INR"),
  exchange_rate: z.coerce.number().nonnegative().default(1),
  smv_rate: z.coerce.number().nonnegative().default(0),
  amendment_no: z.coerce.number().int().nonnegative().default(0),
  reason: z.string().max(500).optional().nullable(),
  task_owner_id: z.string().uuid().optional().nullable(),
  gross_sales_value: z.coerce.number().default(0),
  avg_price: z.coerce.number().default(0),
  sales_value: z.coerce.number().default(0),
  total_expense: z.coerce.number().default(0),
  profit_loss_value: z.coerce.number().default(0),
  profit_loss_pct: z.coerce.number().default(0),
  location_id: z.string().uuid().optional().nullable(),
});
export type BudgetInput = z.infer<typeof budgetInput>;

export const budgetPurchaseInput = z.object({
  budget_id: z.string().uuid(),
  purchase_type: z.enum(PURCHASE_TYPES),
  sno: z.coerce.number().int().default(0),
  item_id: z.string().uuid().optional().nullable(),
  item_name: z.string().max(250).optional().nullable(),
  gsm: z.coerce.number().optional().nullable(),
  stage: z.string().max(100).optional().nullable(),
  item_type: z.string().max(100).optional().nullable(),
  item_color: z.string().max(100).optional().nullable(),
  print_name: z.string().max(100).optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().max(250).optional().nullable(),
  item_process_type: z.string().max(100).optional().nullable(),
  specifications: z.string().max(500).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  reqd_qty: z.coerce.number().nonnegative().default(0),
  is_foc: z.boolean().default(false),
  is_import: z.boolean().default(false),
  currency_code: z.string().max(10).default("INR"),
  exchange_rate: z.coerce.number().nonnegative().default(1),
  is_sizewise_rate: z.boolean().default(false),
  rate: z.coerce.number().nonnegative().default(0),
  inr_rate: z.coerce.number().nonnegative().default(0),
  moq: z.coerce.number().nonnegative().optional().nullable(),
  last_po_rate: z.coerce.number().nonnegative().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetPurchaseInput = z.infer<typeof budgetPurchaseInput>;

export const budgetProcessInput = z.object({
  budget_id: z.string().uuid(),
  process_type: z.enum(PROCESS_TYPES),
  sno: z.coerce.number().int().default(0),
  process_id: z.string().uuid().optional().nullable(),
  process_name: z.string().max(250).optional().nullable(),
  rate_for: z.string().max(100).optional().nullable(),
  rate_for_type: z.string().max(100).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  reqd_qty: z.coerce.number().nonnegative().default(0),
  is_foc: z.boolean().default(false),
  rate_type: z.string().max(100).optional().nullable(),
  charges: z.coerce.number().nonnegative().default(0),
  design_charges: z.coerce.number().nonnegative().default(0),
  po_value: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  is_by_us: z.boolean().default(false),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetProcessInput = z.infer<typeof budgetProcessInput>;

export const budgetProcessItemInput = z.object({
  process_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  description: z.string().max(250).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  reqd_qty: z.coerce.number().nonnegative().default(0),
  is_foc: z.boolean().default(false),
  charges: z.coerce.number().nonnegative().default(0),
  design_charges: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetProcessItemInput = z.infer<typeof budgetProcessItemInput>;

export const budgetCmtInput = z.object({
  budget_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  style_ref_no: z.string().max(100).optional().nullable(),
  style_no: z.string().max(100).optional().nullable(),
  article_no: z.string().max(100).optional().nullable(),
  oc_no: z.string().max(100).optional().nullable(),
  order_no: z.string().max(100).optional().nullable(),
  coordinate_name: z.string().max(100).optional().nullable(),
  order_qty: z.coerce.number().nonnegative().default(0),
  sq_qty: z.coerce.number().nonnegative().default(0),
  smvs: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  is_flat_rate: z.boolean().default(false),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetCmtInput = z.infer<typeof budgetCmtInput>;

export const budgetCmtOperationInput = z.object({
  cmt_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  operation_name: z.string().max(250).optional().nullable(),
  is_sizewise: z.boolean().default(false),
  is_detailwise: z.boolean().default(false),
  is_colorwise: z.boolean().default(false),
  smvs: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetCmtOperationInput = z.infer<typeof budgetCmtOperationInput>;

export const budgetOtherEntryInput = z.object({
  budget_id: z.string().uuid(),
  entry_type: z.enum(OTHER_ENTRY_TYPES),
  sno: z.coerce.number().int().default(0),
  cost_description: z.string().max(250).optional().nullable(),
  description: z.string().max(250).optional().nullable(),
  type_for: z.string().max(100).optional().nullable(),
  rate_type: z.string().max(100).optional().nullable(),
  qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetOtherEntryInput = z.infer<typeof budgetOtherEntryInput>;

export const budgetHeadInput = z.object({
  budget_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  cost_description: z.string().max(250).optional().nullable(),
  cost: z.coerce.number().default(0),
  contribution_pct: z.coerce.number().default(0),
  cost_per_garment: z.coerce.number().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetHeadInput = z.infer<typeof budgetHeadInput>;

export const budgetStyleInput = z.object({
  budget_id: z.string().uuid(),
  sno: z.coerce.number().int().default(0),
  style_ref_no: z.string().max(100).optional().nullable(),
  style_no: z.string().max(100).optional().nullable(),
  article_no: z.string().max(100).optional().nullable(),
  oc_no: z.string().max(100).optional().nullable(),
  order_no: z.string().max(100).optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  order_qty: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  wt_per_garment: z.coerce.number().nonnegative().default(0),
  revenue: z.coerce.number().default(0),
  expenses_fabric: z.coerce.number().default(0),
  expenses_production: z.coerce.number().default(0),
  expenses_cmt: z.coerce.number().default(0),
  expenses_trims: z.coerce.number().default(0),
  expenses_garments: z.coerce.number().default(0),
  expenses_packs: z.coerce.number().default(0),
  expenses_gar_rejection: z.coerce.number().default(0),
  expenses_others: z.coerce.number().default(0),
  expenses_total: z.coerce.number().default(0),
  profit_loss: z.coerce.number().default(0),
  profit_loss_pct: z.coerce.number().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetStyleInput = z.infer<typeof budgetStyleInput>;
