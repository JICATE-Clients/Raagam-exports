import { z } from "zod";

export const PROCESS_TYPES = [
  "knitting",
  "dyeing",
  "stentering",
  "compacting",
  "other",
] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  knitting: "Knitting",
  dyeing: "Dyeing",
  stentering: "Stentering",
  compacting: "Compacting",
  other: "Other",
};

export const PROCESS_JOB_STATUSES = [
  "draft",
  "issued",
  "in_process",
  "received",
  "closed",
] as const;
export type ProcessJobStatus = (typeof PROCESS_JOB_STATUSES)[number];

export const QUALITY_STATUSES = ["passed", "failed", "partial"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export interface ProcessJob {
  id: string;
  code: string | null;
  process_type: ProcessType;
  processor_id: string | null;
  sales_order_id: string | null;
  fabric_bom_id: string | null;
  item_id: string | null;
  description: string | null;
  sent_qty: number;
  uom_id: string | null;
  dc_id: string | null;
  planned_loss_pct: number;
  expected_return_date: string | null;
  status: ProcessJobStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessJobReceipt {
  id: string;
  process_job_id: string;
  received_date: string;
  received_qty: number;
  good_qty: number;
  rejected_qty: number;
  loss_qty: number;
  quality_status: QualityStatus;
  quality_notes: string | null;
  created_by: string | null;
  created_at: string;
}

// ---------- input schemas ----------
export const processJobInput = z.object({
  process_type: z.enum(PROCESS_TYPES),
  processor_id: z.string().uuid().optional().nullable(),
  sales_order_id: z.string().uuid().optional().nullable(),
  fabric_bom_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  sent_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  dc_id: z.string().uuid().optional().nullable(),
  planned_loss_pct: z.coerce.number().min(0).max(100).default(0),
  expected_return_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type ProcessJobInput = z.infer<typeof processJobInput>;

export const processReceiptInput = z.object({
  process_job_id: z.string().uuid(),
  received_date: z.string().optional().nullable(),
  received_qty: z.coerce.number().nonnegative().default(0),
  good_qty: z.coerce.number().nonnegative().default(0),
  rejected_qty: z.coerce.number().nonnegative().default(0),
  quality_status: z.enum(QUALITY_STATUSES).default("passed"),
  quality_notes: z.string().optional().nullable(),
});
export type ProcessReceiptInput = z.infer<typeof processReceiptInput>;

// ---------- computations ----------
/** Process loss = sent − total received (good + rejected). Floored at 0. */
export function processLoss(sentQty: number, totalReceived: number): number {
  return Math.max(0, sentQty - totalReceived);
}

export function actualLossPct(sentQty: number, lossQty: number): number {
  return sentQty > 0 ? (lossQty / sentQty) * 100 : 0;
}

/** Loss against BOM: positive = worse than planned. */
export function lossVarianceVsBom(
  sentQty: number,
  lossQty: number,
  plannedLossPct: number,
): number {
  return actualLossPct(sentQty, lossQty) - plannedLossPct;
}
