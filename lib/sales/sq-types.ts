import { z } from "zod";
import { rejectionFor, sdQtyOf, type RejectionTier } from "@/lib/masters/rejection-rule";

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
  /** NULL = the manual path: `rejection_pct` is typed by hand (0390). */
  rejection_rule_id: string | null;
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
  rejection_rule_id: z.string().uuid().optional().nullable(),
  rejection_pct: z.coerce.number().default(0),
  sq_description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SqDetailInput = z.infer<typeof sqDetailInput>;

/**
 * THE QUANTITY CASCADE, derived rather than typed.
 *
 * `sq_details` has carried `excess_qty`, `rejection_qty`, `gross_qty` and
 * `sq_qty` since 0321 and every one of them has sat at `default 0` on every row,
 * because `createSqDetail` inserts exactly what the form sends and the form only
 * ever sent the two PERCENTAGES. This is the arithmetic that was missing.
 *
 * Called from BOTH sides — the screen shows it live as the operator types, the
 * action recomputes it on save — so what is read and what is stored cannot
 * disagree. Same one-function shape as `missingRequiredMaterialFields`.
 *
 * Two paths, and the rule only takes over when it is actually chosen:
 *
 *  - **A rule is picked** → its tiers decide, through `rejectionFor`. The tier
 *    may be flat pieces or a percentage; `rejection_pct` is then back-computed
 *    from the pieces so the two stored columns describe the same garments.
 *  - **No rule** → the hand-typed `rejection_pct` is honoured exactly as before.
 *    Every SQ raised before 0390 is in this state and must not shift.
 *
 * `rejectionFor` returns null when no tier covers the quantity; that is a rule
 * with a gap in it, and the caller surfaces it rather than storing a silent 0.
 */
export function deriveSqQuantities(input: {
  order_qty: number;
  excess_pct: number;
  rejection_pct: number;
  tiers?: readonly RejectionTier[] | null;
}): { excess_qty: number; rejection_qty: number; rejection_pct: number; gross_qty: number; sq_qty: number; noTier: boolean } {
  const order = Number(input.order_qty) || 0;
  const excessQty = Math.ceil((order * (Number(input.excess_pct) || 0)) / 100);

  let rejectionQty: number;
  let rejectionPct = Number(input.rejection_pct) || 0;
  let noTier = false;

  if (input.tiers && input.tiers.length) {
    const hit = rejectionFor(order, input.tiers);
    if (hit) {
      rejectionQty = hit.rejectionQty;
      // From the ROUNDED pieces, not from the tier's allowance: on a flat tier
      // there is no percentage to copy (3 spares on an order of 2 really is
      // 150%), and on a percent tier the rounding has already moved the number.
      rejectionPct = order > 0 ? Number(((rejectionQty / order) * 100).toFixed(2)) : 0;
    } else {
      rejectionQty = 0;
      noTier = true;
    }
  } else {
    rejectionQty = Math.ceil((order * rejectionPct) / 100);
  }

  const grossQty = order + excessQty + rejectionQty;
  return {
    excess_qty: excessQty,
    rejection_qty: rejectionQty,
    rejection_pct: rejectionPct,
    gross_qty: grossQty,
    // SD Qty. `sdQtyOf` owns the "excess counts too" decision — see the note
    // there; it is 0 on every row today, so all three worked examples hold.
    sq_qty: sdQtyOf(order, excessQty, rejectionQty),
    noTier,
  };
}

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
