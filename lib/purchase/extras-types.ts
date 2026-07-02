import { z } from "zod";

// Shared approval status vocab (over-budget + rate amendment)
export const PUR_APPROVAL_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PurApprovalStatus = (typeof PUR_APPROVAL_STATUSES)[number];
export const PUR_APPROVAL_STATUS_LABELS: Record<PurApprovalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

// ============================================================================
// Purchase Indents (Acknowledge Indents) — 0035
// ============================================================================
export const INDENT_STATUSES = ["open", "acknowledged", "converted", "cancelled"] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];
export const INDENT_STATUS_LABELS: Record<IndentStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  converted: "Converted",
  cancelled: "Cancelled",
};
export interface PurchaseIndent {
  id: string;
  code: string | null;
  department: string;
  sales_order_id: string | null;
  required_date: string | null;
  status: IndentStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface PurchaseIndentLine {
  id: string;
  purchase_indent_id: string;
  item_id: string | null;
  description: string;
  quantity: number;
  uom_id: string | null;
  sort_order: number;
}
export const indentInput = z.object({
  department: z.string().min(1),
  sales_order_id: z.string().uuid().optional().nullable(),
  required_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type IndentInput = z.infer<typeof indentInput>;
export const indentLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().optional(),
});
export type IndentLineInput = z.input<typeof indentLineInput>;

// ============================================================================
// Over-budget Confirmation — 0036
// ============================================================================
export interface OverBudgetConfirmation {
  id: string;
  code: string | null;
  purchase_order_id: string | null;
  rfq_id: string | null;
  description: string;
  budget_rate: number;
  quoted_rate: number;
  variance_pct: number;
  reason: string | null;
  status: PurApprovalStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const overBudgetInput = z.object({
  purchase_order_id: z.string().uuid().optional().nullable(),
  rfq_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  budget_rate: z.coerce.number().nonnegative().default(0),
  quoted_rate: z.coerce.number().nonnegative().default(0),
  reason: z.string().optional().nullable(),
});
export type OverBudgetInput = z.infer<typeof overBudgetInput>;

/** Percentage a quoted rate exceeds the budget rate; 0 if budget is 0. */
export function variancePct(budget: number, quoted: number): number {
  if (!(budget > 0)) return 0;
  return ((quoted - budget) / budget) * 100;
}

// ============================================================================
// PO Rate Amendment — 0037
// ============================================================================
export interface PoRateAmendment {
  id: string;
  code: string | null;
  purchase_order_id: string;
  po_line_item_id: string | null;
  previous_rate: number;
  revised_rate: number;
  reason: string;
  status: PurApprovalStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const rateAmendmentInput = z.object({
  purchase_order_id: z.string().uuid(),
  po_line_item_id: z.string().uuid(),
  revised_rate: z.coerce.number().nonnegative(),
  reason: z.string().min(1),
});
export type RateAmendmentInput = z.infer<typeof rateAmendmentInput>;

// ============================================================================
// PO Cancellation — 0038
// ============================================================================
export interface PoCancellation {
  id: string;
  code: string | null;
  purchase_order_id: string;
  reason: string;
  cancelled_by: string | null;
  created_at: string;
}

// ============================================================================
// Lab / QC — 0039
// ============================================================================
export const LAB_APPLIES = ["general", "customer", "order"] as const;
export type LabApplies = (typeof LAB_APPLIES)[number];
export const LAB_APPLIES_LABELS: Record<LabApplies, string> = {
  general: "General",
  customer: "Customer",
  order: "Order",
};
export const LAB_TEST_MODES = ["in_house", "outside"] as const;
export type LabTestMode = (typeof LAB_TEST_MODES)[number];
export const LAB_TEST_MODE_LABELS: Record<LabTestMode, string> = {
  in_house: "In-house",
  outside: "Outside lab",
};
export const LAB_TEST_STATUSES = ["draft", "issued", "passed", "failed"] as const;
export type LabTestStatus = (typeof LAB_TEST_STATUSES)[number];
export const LAB_TEST_STATUS_LABELS: Record<LabTestStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  passed: "Passed",
  failed: "Failed",
};
export interface LabTestStandard {
  id: string;
  code: string | null;
  name: string;
  parameter: string | null;
  method: string | null;
  spec_min: number | null;
  spec_max: number | null;
  unit: string | null;
  applies_to: LabApplies;
  buyer_id: string | null;
  sales_order_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface LabTest {
  id: string;
  code: string | null;
  standard_id: string | null;
  sales_order_id: string | null;
  item_id: string | null;
  sample_ref: string | null;
  mode: LabTestMode;
  outside_lab_vendor_id: string | null;
  requisition_ref: string | null;
  status: LabTestStatus;
  result_value: number | null;
  result_note: string | null;
  tested_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const labStandardInput = z.object({
  name: z.string().min(1),
  parameter: z.string().optional().nullable(),
  method: z.string().optional().nullable(),
  spec_min: z.coerce.number().optional().nullable(),
  spec_max: z.coerce.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  applies_to: z.enum(LAB_APPLIES).default("general"),
  buyer_id: z.string().uuid().optional().nullable(),
  sales_order_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type LabStandardInput = z.infer<typeof labStandardInput>;
export const labTestInput = z.object({
  standard_id: z.string().uuid().optional().nullable(),
  sales_order_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  sample_ref: z.string().optional().nullable(),
  mode: z.enum(LAB_TEST_MODES).default("in_house"),
  outside_lab_vendor_id: z.string().uuid().optional().nullable(),
  requisition_ref: z.string().optional().nullable(),
});
export type LabTestInput = z.infer<typeof labTestInput>;
