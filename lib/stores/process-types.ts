import { z } from "zod";

export const PROCESS_TYPES = [
  "dyeing", "printing", "knitting", "washing", "finishing", "embroidery", "other",
] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const PROC_STATUSES = [
  "draft", "issued", "in_process", "partially_received", "received", "closed", "cancelled",
] as const;
export type ProcStatus = (typeof PROC_STATUSES)[number];

export const PROC_STATUS_LABELS: Record<ProcStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  in_process: "In Process",
  partially_received: "Partially Received",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const ISSUE_STATUSES = ["draft", "issued"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const RECEIPT_STATUSES = ["draft", "posted"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ProcessOrder {
  id: string;
  code: string | null;
  vendor_id: string;
  location_id: string | null;
  process_type: ProcessType;
  status: ProcStatus;
  order_date: string | null;
  expected_date: string | null;
  currency_code: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessOrderLine {
  id: string;
  process_order_id: string;
  item_id: string | null;
  description: string;
  sent_qty: number;
  received_qty: number;
  uom_id: string | null;
  rate: number;
  amount: number;
  sort_order: number;
}

export interface ProcessMaterialIssue {
  id: string;
  code: string | null;
  process_order_id: string;
  store_id: string;
  issue_date: string | null;
  status: IssueStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessMaterialIssueLine {
  id: string;
  issue_id: string;
  item_id: string | null;
  quantity: number;
  uom_id: string | null;
  sort_order: number;
}

export interface ProcessMaterialReceipt {
  id: string;
  code: string | null;
  process_order_id: string;
  store_id: string;
  receipt_date: string | null;
  status: ReceiptStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessMaterialReceiptLine {
  id: string;
  receipt_id: string;
  item_id: string | null;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  qc_status: string;
  rejection_reason: string | null;
  sort_order: number;
}

// --- Input schemas ---

export const processOrderLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  sent_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type ProcessOrderLineInput = z.infer<typeof processOrderLineInput>;

export const processOrderInput = z.object({
  vendor_id: z.string().uuid(),
  location_id: z.string().uuid().optional().nullable(),
  process_type: z.enum(PROCESS_TYPES),
  order_date: z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(processOrderLineInput).default([]),
});
export type ProcessOrderInput = z.infer<typeof processOrderInput>;

export const processIssueLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type ProcessIssueLineInput = z.infer<typeof processIssueLineInput>;

export const processIssueInput = z.object({
  process_order_id: z.string().uuid(),
  store_id: z.string().uuid(),
  issue_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(processIssueLineInput).default([]),
});
export type ProcessIssueInput = z.infer<typeof processIssueInput>;

export const processReceiptLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  received_qty: z.coerce.number().nonnegative().default(0),
  accepted_qty: z.coerce.number().nonnegative().default(0),
  rejected_qty: z.coerce.number().nonnegative().default(0),
  qc_status: z.string().default("pending"),
  rejection_reason: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type ProcessReceiptLineInput = z.infer<typeof processReceiptLineInput>;

export const processReceiptInput = z.object({
  process_order_id: z.string().uuid(),
  store_id: z.string().uuid(),
  receipt_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(processReceiptLineInput).default([]),
});
export type ProcessReceiptInput = z.infer<typeof processReceiptInput>;
