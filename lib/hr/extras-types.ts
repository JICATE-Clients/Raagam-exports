import { z } from "zod";

// Shared polymorphic employee reference (worker / staff / contractor)
export const EMPLOYEE_TYPES = ["worker", "staff", "contractor"] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  worker: "Worker",
  staff: "Staff",
  contractor: "Contractor",
};
const employeeRef = {
  employee_type: z.enum(EMPLOYEE_TYPES),
  employee_id: z.string().uuid(),
  employee_name: z.string().optional().nullable(),
};

// ============================================================================
// Advances (0210)
// ============================================================================
export const ADVANCE_STATUSES = ["open", "repaying", "closed", "cancelled"] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];
export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  open: "Open",
  repaying: "Repaying",
  closed: "Closed",
  cancelled: "Cancelled",
};
export interface HrAdvance {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  amount: number;
  repaid_amount: number;
  reason: string | null;
  advance_date: string | null;
  status: AdvanceStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const advanceInput = z.object({
  ...employeeRef,
  amount: z.coerce.number().nonnegative().default(0),
  reason: z.string().optional().nullable(),
  advance_date: z.string().optional().nullable(),
});
export type AdvanceInput = z.infer<typeof advanceInput>;

// ============================================================================
// Allowances & Deductions (0211)
// ============================================================================
export const ADJUSTMENT_KINDS = ["allowance", "deduction"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = {
  allowance: "Allowance",
  deduction: "Deduction",
};
export interface HrAdjustment {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  kind: AdjustmentKind;
  label: string;
  amount: number;
  effective_month: string | null;
  recurring: boolean;
  status: "active" | "ended";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const adjustmentInput = z.object({
  ...employeeRef,
  kind: z.enum(ADJUSTMENT_KINDS),
  label: z.string().min(1),
  amount: z.coerce.number().nonnegative().default(0),
  effective_month: z.string().optional().nullable(),
  recurring: z.boolean().default(false),
});
export type AdjustmentInput = z.infer<typeof adjustmentInput>;

// ============================================================================
// Bonus & Increments (0212)
// ============================================================================
export const COMP_KINDS = ["bonus", "increment"] as const;
export type CompKind = (typeof COMP_KINDS)[number];
export const COMP_KIND_LABELS: Record<CompKind, string> = {
  bonus: "Bonus",
  increment: "Increment",
};
export const COMP_STATUSES = ["draft", "approved", "rejected"] as const;
export type CompStatus = (typeof COMP_STATUSES)[number];
export const COMP_STATUS_LABELS: Record<CompStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
};
export interface HrCompEvent {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  kind: CompKind;
  amount: number;
  new_rate: number | null;
  effective_date: string | null;
  reason: string | null;
  status: CompStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const compEventInput = z.object({
  ...employeeRef,
  kind: z.enum(COMP_KINDS),
  amount: z.coerce.number().nonnegative().default(0),
  new_rate: z.coerce.number().nonnegative().optional().nullable(),
  effective_date: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
});
export type CompEventInput = z.infer<typeof compEventInput>;

// ============================================================================
// Leave & Encashment (0213)
// ============================================================================
export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  casual: "Casual",
  sick: "Sick",
  earned: "Earned",
  unpaid: "Unpaid",
};
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export interface HrLeave {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  leave_type: LeaveType;
  from_date: string | null;
  to_date: string | null;
  days: number;
  is_encashment: boolean;
  reason: string | null;
  status: LeaveStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const leaveInput = z.object({
  ...employeeRef,
  leave_type: z.enum(LEAVE_TYPES).default("casual"),
  from_date: z.string().optional().nullable(),
  to_date: z.string().optional().nullable(),
  days: z.coerce.number().nonnegative().default(0),
  is_encashment: z.boolean().default(false),
  reason: z.string().optional().nullable(),
});
export type LeaveInput = z.infer<typeof leaveInput>;

// ============================================================================
// Lifecycle events (0214)
// ============================================================================
export const LIFECYCLE_KINDS = ["transfer", "resignation", "settlement"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];
export const LIFECYCLE_KIND_LABELS: Record<LifecycleKind, string> = {
  transfer: "Transfer",
  resignation: "Resignation",
  settlement: "Settlement",
};
export const LIFECYCLE_STATUSES = ["draft", "completed", "cancelled"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export const LIFECYCLE_STATUS_LABELS: Record<LifecycleStatus, string> = {
  draft: "Draft",
  completed: "Completed",
  cancelled: "Cancelled",
};
export interface HrLifecycleEvent {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  kind: LifecycleKind;
  effective_date: string | null;
  from_location: string | null;
  to_location: string | null;
  last_working_day: string | null;
  settlement_amount: number | null;
  reason: string | null;
  status: LifecycleStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const lifecycleInput = z.object({
  ...employeeRef,
  kind: z.enum(LIFECYCLE_KINDS),
  effective_date: z.string().optional().nullable(),
  from_location: z.string().optional().nullable(),
  to_location: z.string().optional().nullable(),
  last_working_day: z.string().optional().nullable(),
  settlement_amount: z.coerce.number().nonnegative().optional().nullable(),
  reason: z.string().optional().nullable(),
});
export type LifecycleInput = z.infer<typeof lifecycleInput>;

// ============================================================================
// Statutory documents (0215)
// ============================================================================
export const STATUTORY_FORM_TYPES = ["esi_form3", "esi_form5", "esi_form10", "strength_correction"] as const;
export type StatutoryFormType = (typeof STATUTORY_FORM_TYPES)[number];
export const STATUTORY_FORM_LABELS: Record<StatutoryFormType, string> = {
  esi_form3: "ESI Form 3 (Declaration)",
  esi_form5: "ESI Form 5 (Joining)",
  esi_form10: "ESI Form 10 (Leaving)",
  strength_correction: "Strength Correction",
};
export interface HrStatutoryDoc {
  id: string;
  code: string | null;
  employee_type: EmployeeType;
  employee_id: string;
  employee_name: string | null;
  form_type: StatutoryFormType;
  reference_no: string | null;
  doc_date: string | null;
  notes: string | null;
  status: "draft" | "filed";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const statutoryInput = z.object({
  ...employeeRef,
  form_type: z.enum(STATUTORY_FORM_TYPES),
  reference_no: z.string().optional().nullable(),
  doc_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type StatutoryInput = z.infer<typeof statutoryInput>;
