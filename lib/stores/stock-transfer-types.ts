import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Stock Transfer (0803) — moves stock between OWNERS (General Stock ↔ RE / IWO /
// SWO) and / or between STORES of one unit. doc/stores/stock-transfer-plan.md.
// ============================================================================

export const STOCK_TRANSFER_STATUS_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;
export type StockTransferStatus = keyof typeof STOCK_TRANSFER_STATUS_LABELS;

/** The four kinds of transfer the EDITOR raises, in the order its toggle shows them. */
export const TRANSFER_TYPES = [
  { value: "general_to_order", label: "General → Order" },
  { value: "order_to_order", label: "Order → Order" },
  { value: "order_to_general", label: "Order → General" },
  { value: "store_to_store", label: "Store → Store" },
] as const;
/**
 * Plus `bin_to_bin` (0809): raised and posted in one step by `assignBin` from Inventory
 * Dashboard's "Assign a bin", never typed in the editor — so it is on the register and the print
 * but not on the toggle.
 */
export type TransferType = (typeof TRANSFER_TYPES)[number]["value"] | "bin_to_bin";
export const TRANSFER_TYPE_LABELS: Record<TransferType, string> = {
  ...(Object.fromEntries(TRANSFER_TYPES.map((t) => [t.value, t.label])) as Record<(typeof TRANSFER_TYPES)[number]["value"], string>),
  bin_to_bin: "Bin → Bin",
};

/** Which side names an order, per type. Store → Store keeps whatever owner the From side has. */
export function sidesFor(type: TransferType): { from: "general" | "order" | "any"; to: "general" | "order" | "same" } {
  switch (type) {
    case "general_to_order":
      return { from: "general", to: "order" };
    case "order_to_order":
      return { from: "order", to: "order" };
    case "order_to_general":
      return { from: "order", to: "general" };
    case "store_to_store":
    case "bin_to_bin":
      return { from: "any", to: "same" };
  }
}

/** Order → Order and Order → General move cost off an order's books, so they say why. */
export function remarksRequired(type: TransferType): boolean {
  return type === "order_to_order" || type === "order_to_general";
}

export type OrderKind = "re" | "iwo" | "swo";

/** An order a transfer can name (opening_stock_group_options, 0801). */
export interface TransferOrderOption {
  kind: OrderKind;
  id: string;
  name: string;
  inactive: boolean;
}

export interface TransferStoreOption {
  id: string;
  name: string;
  store_type: string;
}

export interface TransferBinOption {
  id: string;
  code: string;
  description: string | null;
  inactive?: boolean;
  store_id: string | null;
}

/** One stock layer still on hand — what a line draws from (stock_transfer_layers, 0803). */
export interface TransferLayer {
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

/** A requirement line of the target order (po_requirement_lines). */
export interface TransferReqLine {
  req_key: string;
  item_id: string;
  label: string;
  uom_code: string | null;
  balance_qty: number;
}

export interface StockTransfer {
  id: string;
  code: string | null;
  transfer_date: string;
  transfer_type: TransferType;
  from_store_id: string;
  to_store_id: string;
  from_garment_order_id: string | null;
  from_iwo_id: string | null;
  to_garment_order_id: string | null;
  to_iwo_id: string | null;
  remarks: string | null;
  status: StockTransferStatus;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockTransferLine {
  id: string;
  transfer_id: string;
  source_ledger_id: string;
  item_id: string;
  quantity: number;
  to_bin_id: string | null;
  req_key: string | null;
  bags: number | null;
  cones: number | null;
  sort_order: number;
  /** Joined for display: a posted line's layer is spent, so it is named from the ledger row. */
  item_name: string | null;
  lot_no: string | null;
  uom_code: string | null;
  from_bin_code: string | null;
  to_bin_code: string | null;
  rate: number | null;
}

const optUuid = z.string().uuid().nullable().optional();
const optCount = z.coerce.number().int("Bags / cones are whole numbers").min(0).nullable().optional();

export const stockTransferLineInput = z.object({
  source_ledger_id: z.string().uuid("Pick the stock to move"),
  quantity: z.coerce.number().positive("Transfer qty must be more than 0"),
  to_bin_id: optUuid,
  req_key: z.string().trim().nullable().optional(),
  bags: optCount,
  cones: optCount,
});
export type StockTransferLineInput = z.input<typeof stockTransferLineInput>;

export const stockTransferInput = z
  .object({
    transfer_date: z.string().min(1, "Date is required"),
    transfer_type: z.enum(["general_to_order", "order_to_order", "order_to_general", "store_to_store"]),
    from_store_id: z.string().uuid("Pick the From store"),
    to_store_id: z.string().uuid("Pick the To store"),
    from_garment_order_id: optUuid,
    from_iwo_id: optUuid,
    to_garment_order_id: optUuid,
    to_iwo_id: optUuid,
    remarks: capsTextNullable(),
    lines: z.array(stockTransferLineInput).min(1, "Add at least one line"),
  })
  .superRefine((v, ctx) => {
    if (remarksRequired(v.transfer_type) && !v.remarks) {
      ctx.addIssue({ code: "custom", path: ["remarks"], message: "Remarks are required — this moves cost off an order's books" });
    }
    // ONE LOT, SEVERAL BINS (0813, GRN's split): a layer may appear once PER To bin — the
    // screen saves one line per bin of a split. The same layer into the same bin (or twice
    // with no bin) is still the same move entered twice — the DB's unique rule says so too.
    const seen = new Set<string>();
    for (const l of v.lines) {
      const k = `${l.source_ledger_id}|${l.to_bin_id ?? ""}`;
      if (seen.has(k)) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: "The same stock is picked twice into the same bin" });
        return;
      }
      seen.add(k);
    }
  });
export type StockTransferInput = z.input<typeof stockTransferInput>;
