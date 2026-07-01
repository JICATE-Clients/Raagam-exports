import { z } from "zod";

export const STORE_TYPES = [
  "purchase",
  "processing",
  "material",
  "rejection",
  "surplus",
] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export const STORE_TYPE_LABELS: Record<StoreType, string> = {
  purchase: "Purchase Store",
  processing: "Processing Store",
  material: "Material Store",
  rejection: "Rejection Store",
  surplus: "Surplus Store",
};

export const MOVEMENT_TYPES = [
  "receipt",
  "issue",
  "return",
  "transfer_in",
  "transfer_out",
  "adjust_in",
  "adjust_out",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  receipt: "Receipt",
  issue: "Issue",
  return: "Return",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  adjust_in: "Adjustment (+)",
  adjust_out: "Adjustment (−)",
};

const INBOUND: MovementType[] = ["receipt", "return", "transfer_in", "adjust_in"];

/** +1 for inbound movements, -1 for outbound. */
export function movementSign(type: MovementType): 1 | -1 {
  return INBOUND.includes(type) ? 1 : -1;
}
export function isInbound(type: MovementType): boolean {
  return INBOUND.includes(type);
}

// ---------- interfaces ----------
export interface Store {
  id: string;
  code: string;
  name: string;
  store_type: StoreType;
  location_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockLedgerEntry {
  id: string;
  store_id: string;
  item_id: string;
  movement_type: MovementType;
  quantity: number;
  counterparty_store_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StockBalance {
  store_id: string;
  item_id: string;
  quantity: number;
  updated_at: string;
}

export interface StoreAccessRow {
  id: string;
  user_id: string;
  store_id: string;
  created_at: string;
}

// ---------- input schemas ----------
/** Manual movement: receipt / issue / return / adjust_in / adjust_out. */
export const stockMovementInput = z.object({
  store_id: z.string().uuid(),
  item_id: z.string().uuid(),
  movement_type: z.enum([
    "receipt",
    "issue",
    "return",
    "adjust_in",
    "adjust_out",
  ]),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  reference_type: z.string().optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
  note: z.string().optional().nullable(),
});
export type StockMovementInput = z.infer<typeof stockMovementInput>;

/** Transfer between two stores (creates paired transfer_out + transfer_in). */
export const stockTransferInput = z.object({
  from_store_id: z.string().uuid(),
  to_store_id: z.string().uuid(),
  item_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  note: z.string().optional().nullable(),
});
export type StockTransferInput = z.infer<typeof stockTransferInput>;

export const storeInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  store_type: z.enum(STORE_TYPES),
  location_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type StoreInput = z.infer<typeof storeInput>;

export const storeAccessInput = z.object({
  user_id: z.string().uuid(),
  store_id: z.string().uuid(),
});
export type StoreAccessInput = z.infer<typeof storeAccessInput>;
