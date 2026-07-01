import { z } from "zod";

export const WORKER_TYPES = [
  "shift",
  "contractor_piece",
  "company_piece",
] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  shift: "Shift (Company)",
  contractor_piece: "Piece-rate (Contractor)",
  company_piece: "Piece-rate (Company)",
};

export const RUN_KINDS = ["worker", "staff"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const PERIOD_TYPES = ["weekly", "monthly"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const PAYROLL_STATUSES = [
  "draft",
  "calculated",
  "approved",
  "locked",
  "paid",
] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

// ---------- interfaces ----------
export interface Contractor {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  location_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  code: string | null;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  location_id: string | null;
  biometric_id: string | null;
  shift_wage_per_day: number;
  hourly_wage: number;
  piece_rate: number;
  esi_applicable: boolean;
  pf_applicable: boolean;
  joined_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  code: string | null;
  name: string;
  designation: string | null;
  location_id: string | null;
  monthly_salary: number;
  esi_applicable: boolean;
  pf_applicable: boolean;
  joined_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PayrollSettings {
  id: string;
  ot_multiplier: number;
  max_ot_hours_per_day: number;
  max_ot_hours_per_month: number;
  esi_rate: number;
  pf_rate: number;
  currency: string;
  updated_at: string;
}

export interface WorkerAttendance {
  id: string;
  worker_id: string;
  work_date: string;
  present: boolean;
  normal_hours: number;
  ot_hours: number;
  extra_hours: number;
  source: "biometric" | "manual";
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerPieceRecord {
  id: string;
  worker_id: string;
  work_date: string;
  pieces: number;
  sales_order_id: string | null;
  is_locked: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollRun {
  id: string;
  code: string | null;
  run_kind: RunKind;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  location_id: string | null;
  status: PayrollStatus;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollLine {
  id: string;
  payroll_run_id: string;
  worker_id: string | null;
  staff_id: string | null;
  worker_type: WorkerType | null;
  days_worked: number;
  ot_hours: number;
  ot_wage: number;
  actual_gross: number;
  esi: number;
  pf: number;
  actual_net: number;
  pieces: number;
  extra_wage: number;
  total_net: number;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ContractorPayrollRow {
  id: string;
  payroll_run_id: string;
  contractor_id: string;
  total_pieces: number;
  piece_amount: number;
  sum_actual_wages: number;
  extra_wage: number;
  created_at: string;
}

// ---------- input schemas ----------
export const contractorInput = z.object({
  name: z.string().min(1),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ContractorInput = z.infer<typeof contractorInput>;

export const workerInput = z.object({
  name: z.string().min(1),
  worker_type: z.enum(WORKER_TYPES),
  contractor_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  biometric_id: z.string().optional().nullable(),
  shift_wage_per_day: z.coerce.number().nonnegative().default(0),
  hourly_wage: z.coerce.number().nonnegative().default(0),
  piece_rate: z.coerce.number().nonnegative().default(0),
  esi_applicable: z.boolean().default(true),
  pf_applicable: z.boolean().default(true),
  joined_date: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type WorkerInput = z.infer<typeof workerInput>;

export const staffInput = z.object({
  name: z.string().min(1),
  designation: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  monthly_salary: z.coerce.number().nonnegative().default(0),
  esi_applicable: z.boolean().default(true),
  pf_applicable: z.boolean().default(true),
  joined_date: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type StaffInput = z.infer<typeof staffInput>;

export const payrollSettingsInput = z.object({
  ot_multiplier: z.coerce.number().min(1).default(2),
  max_ot_hours_per_day: z.coerce.number().min(0).default(4),
  max_ot_hours_per_month: z.coerce.number().min(0).default(50),
  esi_rate: z.coerce.number().min(0).max(1).default(0.0075),
  pf_rate: z.coerce.number().min(0).max(1).default(0.12),
  currency: z.string().default("INR"),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsInput>;

export const attendanceInput = z.object({
  worker_id: z.string().uuid(),
  work_date: z.string(),
  present: z.boolean().default(true),
  normal_hours: z.coerce.number().min(0).default(0),
  ot_hours: z.coerce.number().min(0).default(0),
  extra_hours: z.coerce.number().min(0).default(0),
  source: z.enum(["biometric", "manual"]).default("manual"),
  note: z.string().optional().nullable(),
});
export type AttendanceInput = z.infer<typeof attendanceInput>;

export const pieceRecordInput = z.object({
  worker_id: z.string().uuid(),
  work_date: z.string(),
  pieces: z.coerce.number().int().nonnegative().default(0),
  sales_order_id: z.string().uuid().optional().nullable(),
});
export type PieceRecordInput = z.infer<typeof pieceRecordInput>;

export const payrollRunInput = z.object({
  run_kind: z.enum(RUN_KINDS).default("worker"),
  period_type: z.enum(PERIOD_TYPES).default("weekly"),
  period_start: z.string(),
  period_end: z.string(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PayrollRunInput = z.infer<typeof payrollRunInput>;
