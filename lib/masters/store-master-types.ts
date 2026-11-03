import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { STORE_TYPES, type StoreType } from "@/lib/stores/types";

// ============================================================================
// STORE MASTER (0800, user 2026-11-03). The store rooms of the unit the operator is
// working in: Material, Purchase, Processing, Rejection, Surplus and In Transit (one
// each, used by the system to route stock) and any number of Storage stores (Yarn Store,
// Fabric Store …) that only appear in pickers. Each store may carry a Bin Prefix: a new
// bin in it left without a code is numbered PREFIX + 001, 002 … (bin-actions).
// ============================================================================
export interface StoreRow {
  id: string;
  code: string;
  name: string;
  store_type: StoreType;
  location_id: string;
  bin_prefix: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

export const storeInput = z.object({
  /** Blank = generated from the name (createStore). Fixed once saved. */
  code: z.string().trim().toUpperCase().optional().default(""),
  name: capsName(),
  store_type: z.enum(STORE_TYPES, { message: "Pick the store type" }),
  bin_prefix: capsTextNullable(),
  is_active: z.boolean().default(true),
});
export type StoreInput = z.infer<typeof storeInput>;
