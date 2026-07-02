import { z } from "zod";

// ============================================================================
// Planning masters — Work Types & Sewing Operations (0204)
// ============================================================================
export interface WorkType {
  id: string;
  code: string | null;
  stage: string | null;
  short_name: string | null;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const workTypeInput = z.object({
  stage: z.string().optional().nullable(),
  short_name: z.string().optional().nullable(),
  name: z.string().min(1),
});
export type WorkTypeInput = z.infer<typeof workTypeInput>;

export interface SewingOperation {
  id: string;
  code: string | null;
  name: string;
  smv: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const sewingOperationInput = z.object({
  name: z.string().min(1),
  smv: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SewingOperationInput = z.infer<typeof sewingOperationInput>;

// ============================================================================
// Job Orders (0205)
// ============================================================================
export const JOB_ORDER_STATUSES = ["draft", "open", "completed", "cancelled"] as const;
export type JobOrderStatus = (typeof JOB_ORDER_STATUSES)[number];
export const JOB_ORDER_STATUS_LABELS: Record<JobOrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  completed: "Completed",
  cancelled: "Cancelled",
};
export interface ProductionJobOrder {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  description: string | null;
  stage_from: string | null;
  stage_to: string | null;
  style_ref: string | null;
  status: JobOrderStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface JobOrderComponent {
  id: string;
  job_order_id: string;
  component_name: string;
  description: string | null;
  quantity: number;
  sort_order: number;
}
export const jobOrderInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  stage_from: z.string().optional().nullable(),
  stage_to: z.string().optional().nullable(),
  style_ref: z.string().optional().nullable(),
});
export type JobOrderInput = z.infer<typeof jobOrderInput>;
export const jobOrderComponentInput = z.object({
  component_name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().optional(),
});
export type JobOrderComponentInput = z.input<typeof jobOrderComponentInput>;

// ============================================================================
// Contractor Piece Rates (0206)
// ============================================================================
export const PIECE_RATE_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PieceRateStatus = (typeof PIECE_RATE_STATUSES)[number];
export const PIECE_RATE_STATUS_LABELS: Record<PieceRateStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};
export interface ContractorPieceRate {
  id: string;
  code: string | null;
  contractor_id: string | null;
  work_type_id: string | null;
  operation: string | null;
  rate: number;
  effective_date: string | null;
  status: PieceRateStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const pieceRateInput = z.object({
  contractor_id: z.string().uuid().optional().nullable(),
  work_type_id: z.string().uuid().optional().nullable(),
  operation: z.string().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  effective_date: z.string().optional().nullable(),
});
export type PieceRateInput = z.infer<typeof pieceRateInput>;

// ============================================================================
// Packing List (0207)
// ============================================================================
export const PACKING_STATUSES = ["draft", "finalized", "cancelled"] as const;
export type PackingStatus = (typeof PACKING_STATUSES)[number];
export const PACKING_STATUS_LABELS: Record<PackingStatus, string> = {
  draft: "Draft",
  finalized: "Finalized",
  cancelled: "Cancelled",
};
export interface PackingList {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  packing_date: string | null;
  status: PackingStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface PackingListLine {
  id: string;
  packing_list_id: string;
  carton_no: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  net_weight: number | null;
  gross_weight: number | null;
  sort_order: number;
}
export const packingListInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  packing_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PackingListInput = z.infer<typeof packingListInput>;
export const packingLineInput = z.object({
  carton_no: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  net_weight: z.coerce.number().nonnegative().optional().nullable(),
  gross_weight: z.coerce.number().nonnegative().optional().nullable(),
  sort_order: z.coerce.number().int().optional(),
});
export type PackingLineInput = z.input<typeof packingLineInput>;

// ============================================================================
// Inspection (0208)
// ============================================================================
export const INSPECTION_RESULTS = ["pending", "pass", "fail", "rework"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];
export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  rework: "Rework",
};
export const INSPECTION_STATUSES = ["draft", "completed", "cancelled"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  draft: "Draft",
  completed: "Completed",
  cancelled: "Cancelled",
};
export interface Inspection {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  inspection_date: string | null;
  inspector: string | null;
  sample_size: number;
  defects_found: number;
  result: InspectionResult;
  status: InspectionStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const inspectionInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  inspection_date: z.string().optional().nullable(),
  inspector: z.string().optional().nullable(),
  sample_size: z.coerce.number().nonnegative().default(0),
  defects_found: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
export type InspectionInput = z.infer<typeof inspectionInput>;

// ============================================================================
// Despatch (0209)
// ============================================================================
export const DESPATCH_STATUSES = ["draft", "despatched", "cancelled"] as const;
export type DespatchStatus = (typeof DESPATCH_STATUSES)[number];
export const DESPATCH_STATUS_LABELS: Record<DespatchStatus, string> = {
  draft: "Draft",
  despatched: "Despatched",
  cancelled: "Cancelled",
};
export interface Despatch {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  despatch_date: string | null;
  vehicle_no: string | null;
  destination: string | null;
  cartons: number;
  status: DespatchStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const despatchInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  despatch_date: z.string().optional().nullable(),
  vehicle_no: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  cartons: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
export type DespatchInput = z.infer<typeof despatchInput>;
