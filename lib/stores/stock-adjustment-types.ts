import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Stock Adjustment (0805) — Increase / Decrease one lot to match the scale
// (moisture gain / loss, recount, damage). Stock Transfer's shape (0803) with
// no "to" side: a line names a LAYER of the header store and owner, and posts
// at that lot's rate and FIFO place.
// ============================================================================

export const STOCK_ADJUSTMENT_STATUS_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;
export type StockAdjustmentStatus = keyof typeof STOCK_ADJUSTMENT_STATUS_LABELS;

export const ADJ_STOCK_TYPES = [
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "replacement", label: "Replacement" },
] as const;
export type AdjStockType = (typeof ADJ_STOCK_TYPES)[number]["value"];

export const ADJ_DIRECTIONS = [
  { value: "increase", label: "Increase (+)" },
  { value: "decrease", label: "Decrease (−)" },
] as const;
export type AdjDirection = (typeof ADJ_DIRECTIONS)[number]["value"];

export const ADJ_REASONS = [
  { value: "moisture", label: "Moisture" },
  { value: "recount", label: "Recount" },
  { value: "damage", label: "Damage" },
  { value: "other", label: "Other" },
] as const;
export type AdjReason = (typeof ADJ_REASONS)[number]["value"];
export const ADJ_REASON_LABELS: Record<AdjReason, string> = Object.fromEntries(
  ADJ_REASONS.map((r) => [r.value, r.label]),
) as Record<AdjReason, string>;

/**
 * Which stores a stock type may use — Rejected / Replacement stock is kept in the unit's
 * Rejection store, Accepted never is (0801's rule; the DB guard refuses the other pairings).
 */
export function storeFitsType(storeType: string, stockType: AdjStockType): boolean {
  return stockType === "accepted" ? storeType !== "rejection" : storeType === "rejection";
}

export type AdjOrderKind = "re" | "iwo" | "swo";

/** A group the header can name (opening_stock_group_options, 0801). */
export interface AdjOrderOption {
  kind: AdjOrderKind;
  id: string;
  label: string;
  customer: string | null;
  inactive: boolean;
}

export interface AdjStoreOption {
  id: string;
  name: string;
  store_type: string;
}

/** One lot still on hand (stock_adjustment_layers, 0805). */
export interface AdjLayer {
  layer_id: string;
  item_id: string;
  item_name: string;
  item_class: string | null;
  category: string | null;
  uom_code: string | null;
  bin_id: string | null;
  bin_code: string | null;
  lot_no: string | null;
  grn_code: string | null;
  in_date: string | null;
  age_days: number | null;
  qty_on_hand: number;
  /** Null when the operator may not see money (Stock Statement with Value grant). */
  rate: number | null;
}

export interface StockAdjustment {
  id: string;
  code: string | null;
  adjustment_date: string;
  stock_type: AdjStockType;
  store_id: string;
  garment_order_id: string | null;
  iwo_id: string | null;
  remarks: string | null;
  status: StockAdjustmentStatus;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockAdjustmentLine {
  id: string;
  adjustment_id: string;
  source_ledger_id: string;
  item_id: string;
  direction: AdjDirection;
  reason: AdjReason;
  quantity: number;
  bags: number | null;
  sort_order: number;
  /** Joined for display — a posted line's layer may be spent, so it is named from the ledger row. */
  item_name: string | null;
  uom_code: string | null;
  lot_no: string | null;
  bin_code: string | null;
  /** Stamped at post; null on a draft or for an operator without the money grant. */
  rate: number | null;
}

/** +qty for an Increase, −qty for a Decrease. */
export function signedQty(direction: AdjDirection, qty: number): number {
  return direction === "decrease" ? -qty : qty;
}

const optUuid = z.string().uuid().nullable().optional();

export const stockAdjustmentLineInput = z.object({
  source_ledger_id: z.string().uuid("Pick the lot to adjust"),
  direction: z.enum(["increase", "decrease"]),
  reason: z.enum(["moisture", "recount", "damage", "other"]),
  quantity: z.coerce.number().positive("Adjustment qty must be more than 0"),
  bags: z.coerce.number().int("Bags are whole numbers").min(0).nullable().optional(),
});
export type StockAdjustmentLineInput = z.input<typeof stockAdjustmentLineInput>;

export const stockAdjustmentInput = z
  .object({
    adjustment_date: z.string().min(1, "Date is required"),
    stock_type: z.enum(["accepted", "rejected", "replacement"]),
    store_id: z.string().uuid("Pick the store"),
    garment_order_id: optUuid,
    iwo_id: optUuid,
    remarks: capsTextNullable(),
    lines: z.array(stockAdjustmentLineInput).min(1, "Add at least one line"),
  })
  .superRefine((v, ctx) => {
    if (!v.remarks) {
      ctx.addIssue({ code: "custom", path: ["remarks"], message: "Remarks are required — say why the stock is being adjusted" });
    }
    const seen = new Set<string>();
    for (const l of v.lines) {
      if (seen.has(l.source_ledger_id)) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: "The same lot is picked on two lines" });
        return;
      }
      seen.add(l.source_ledger_id);
    }
  });
export type StockAdjustmentInput = z.input<typeof stockAdjustmentInput>;
