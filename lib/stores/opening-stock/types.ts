import { z } from "zod";

/**
 * OPENING STOCK BALANCE (0801, user 2026-11-03). Types shared by the screen, the service and
 * the actions. The rules themselves live in SQL (`opening_stock_save` / `opening_stock_post`);
 * what is here is the shape, and the few checks the screen makes before it asks.
 */

export const OPENING_STOCK_STATUS_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;
export type OpeningStockStatus = keyof typeof OPENING_STOCK_STATUS_LABELS;

/** Header-level (decision 1). Rejected / Replacement post into the unit's Rejection store. */
export const STOCK_TYPES = [
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "replacement", label: "Replacement" },
] as const;
export type StockType = (typeof STOCK_TYPES)[number]["value"];
export const STOCK_TYPE_LABELS: Record<StockType, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  replacement: "Replacement",
};

/** The same four words GRN uses (0778). */
export const GROUP_KINDS = [
  { value: "general", label: "General" },
  { value: "re", label: "Order / RE" },
  { value: "iwo", label: "Internal / IWO" },
  { value: "swo", label: "Sample / SWO" },
] as const;
export type GroupKind = (typeof GROUP_KINDS)[number]["value"];

export interface OpeningStock {
  id: string;
  code: string | null;
  store_id: string;
  opening_date: string | null;
  status: OpeningStockStatus;
  stock_type: StockType;
  group_kind: GroupKind;
  garment_order_id: string | null;
  iwo_id: string | null;
  notes: string | null;
  posted_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface OpeningStockBin {
  bin_id: string;
  qty: number;
}

export interface OpeningStockLine {
  id: string;
  item_id: string;
  store_id: string | null;
  lot_no: string | null;
  ref_no: string | null;
  ref_date: string | null;
  bags: number | null;
  bag_weight: number | null;
  quantity: number;
  rate: number | null;
  uom_id: string | null;
  note: string | null;
  bins: OpeningStockBin[];
}

/** An item the line can pick — `RecordPicker`'s shape plus what the line reads off it. */
export interface OpeningItemOption {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  item_class_id: string | null;
  item_class: string | null;
  is_yarn: boolean;
  uom_id: string | null;
  uom_code: string | null;
  /** The item master's budget rate — offered as the line's rate when it is blank. */
  budget_rate: number | null;
}

export interface OpeningStoreOption {
  id: string;
  name: string;
  store_type: string;
}

export interface OpeningBinOption {
  id: string;
  code: string;
  description: string | null;
  inactive?: boolean;
  store_id: string | null;
}

/** An order the header can name (`opening_stock_group_options()`). */
export interface OpeningGroupOption {
  kind: Exclude<GroupKind, "general">;
  id: string;
  code: string | null;
  name: string;
  customer_name: string | null;
  inactive: boolean;
}

const uuid = z.string().uuid();
const optUuid = z.string().uuid().nullable().optional();
const optText = z.string().trim().nullable().optional();
const optNum = z.number().finite().nonnegative().nullable().optional();

export const openingStockLineInput = z.object({
  item_id: uuid,
  store_id: optUuid,
  lot_no: optText,
  ref_no: optText,
  ref_date: z.string().nullable().optional(),
  bags: optNum,
  bag_weight: optNum,
  quantity: z.number().finite().positive("Every line needs an opening qty"),
  rate: z.number().finite().nonnegative("Every line needs a rate"),
  uom_id: optUuid,
  note: optText,
  bins: z.array(z.object({ bin_id: uuid, qty: z.number().finite().positive() })).default([]),
});

export const openingStockInput = z
  .object({
    store_id: z.string().uuid("Pick the target store"),
    opening_date: z.string().min(1, "Opening date is required"),
    stock_type: z.enum(["accepted", "rejected", "replacement"]),
    group_kind: z.enum(["general", "re", "iwo", "swo"]),
    garment_order_id: optUuid,
    iwo_id: optUuid,
    notes: optText,
    lines: z.array(openingStockLineInput).min(1, "Add at least one line"),
  })
  .refine((d) => d.group_kind === "general" || !!(d.group_kind === "re" ? d.garment_order_id : d.iwo_id), {
    message: "Pick the order the stock is held for",
  });
export type OpeningStockInput = z.input<typeof openingStockInput>;

/**
 * ONE ITEM OF AN ORDER'S REQUIREMENT PLAN (2026-11-05, doc/stores/opening-stock-order-items-plan.md).
 * Read from `po_requirement_lines` — the source Raise PO and Stock Transfer read — and summed
 * per item, because one item can sit on several slices (colour, size) of the same order.
 * With an order picked, the line's Item list is these items and nothing else.
 */
export interface OpeningPlanItem {
  item_id: string;
  required_qty: number;
  balance_qty: number;
  uom_code: string | null;
}

/** An order's plan as the screen holds it: `null` items = not loaded (or failed), never "empty". */
export type OpeningOrderPlan = { orderId: string; items: OpeningPlanItem[] } | { orderId: string; error: string };
