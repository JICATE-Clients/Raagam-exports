import { z } from "zod";

// ---------------------------------------------------------------------------
// SQ Detail types
// ---------------------------------------------------------------------------

export interface SqDetail {
  id: string;
  code: string | null;
  opportunity_id: string;
  sq_date: string;
  customer_id: string | null;
  sq_sub_type: string | null;
  sourcing_type: string | null;
  merchandiser_id: string | null;
  delivery_date: string | null;
  proposed_delivery_date: string | null;
  delivery_window_from: string | null;
  delivery_window_to: string | null;
  uom_id: string | null;
  order_qty: number;
  excess_pct: number;
  excess_qty: number;
  rejection_pct: number;
  rejection_qty: number;
  approval_qty: number;
  gross_qty: number;
  sq_qty: number;
  sq_description: string | null;
  amendment_sno: number;
  is_cancelled: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SqPack {
  id: string;
  sq_detail_id: string;
  sno: number;
  country_code: string | null;
  pack_no: number | null;
  customer_order_no: string | null;
  design: string | null;
  consignee_name: string | null;
  assortment_type: string | null;
  no_of_cartons: number | null;
  sq_qty: number;
  delivery_date: string | null;
  excess_pct: number;
}

export interface SqQuantity {
  id: string;
  sq_detail_id: string;
  sq_pack_id: string | null;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  uom_id: string | null;
  order_qty: number;
  excess_qty: number;
  approval_qty: number;
  gross_qty: number;
  rejection_qty: number;
  rejection_pct: number;
  sq_qty: number;
}

export interface SqQtyCombo {
  id: string;
  sq_quantity_id: string;
  sno: number;
  combo: string | null;
  order_qty: number;
  excess_qty: number;
  approval_qty: number;
  gross_qty: number;
  rejection_qty: number;
  rejection_pct: number;
  sq_qty: number;
}

export interface SqQtySize {
  id: string;
  sq_qty_combo_id: string | null;
  sq_quantity_id: string | null;
  sno: number;
  garment_size: string;
  order_qty: number;
  excess_qty: number;
  approval_qty: number;
  gross_qty: number;
  rejection_qty: number;
  rejection_pct: number;
  sq_qty: number;
}

// ---------------------------------------------------------------------------
// SQ Groups
// ---------------------------------------------------------------------------

export interface SqGroup {
  id: string;
  code: string | null;
  group_date: string;
  group_description: string | null;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// SQ Notes
// ---------------------------------------------------------------------------

export interface SqDetailNote {
  id: string;
  code: string | null;
  sq_detail_id: string;
  entry_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// SQ Cancellations
// ---------------------------------------------------------------------------

export interface SqCancellation {
  id: string;
  code: string | null;
  sq_detail_id: string;
  entry_date: string;
  reason: string | null;
  task_owner: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Zod Input Schemas
// ---------------------------------------------------------------------------

export const SQ_SUB_TYPES = ["orders", "salesman_sample"] as const;
export const SOURCING_TYPES = ["in_house", "outsource"] as const;
export const SQ_STATUSES = ["draft", "confirmed", "cancelled"] as const;

export const sqDetailInput = z.object({
  opportunity_id: z.string().uuid(),
  sq_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  sq_sub_type: z.enum(SQ_SUB_TYPES).optional().nullable(),
  sourcing_type: z.enum(SOURCING_TYPES).optional().nullable(),
  merchandiser_id: z.string().uuid().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  proposed_delivery_date: z.string().optional().nullable(),
  delivery_window_from: z.string().optional().nullable(),
  delivery_window_to: z.string().optional().nullable(),
  uom_id: z.string().optional().nullable(),
  order_qty: z.coerce.number().default(0),
  excess_pct: z.coerce.number().default(0),
  rejection_pct: z.coerce.number().default(0),
  sq_description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SqDetailInput = z.infer<typeof sqDetailInput>;

export const sqGroupInput = z.object({
  group_date: z.string(),
  group_description: z.string().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
});
export type SqGroupInput = z.infer<typeof sqGroupInput>;

export const sqDetailNoteInput = z.object({
  sq_detail_id: z.string().uuid(),
  entry_date: z.string(),
  notes: z.string().optional().nullable(),
});
export type SqDetailNoteInput = z.infer<typeof sqDetailNoteInput>;

export const sqCancellationInput = z.object({
  sq_detail_id: z.string().uuid(),
  entry_date: z.string(),
  reason: z.string().optional().nullable(),
  task_owner: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SqCancellationInput = z.infer<typeof sqCancellationInput>;
