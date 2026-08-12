import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// Stock Units — the enriched UOM master (0224 adds columns to `uoms`). Legacy
// EDP2 "Stock unit" form: Unit of Measurement + Description + No. of Decimal
// Places + Item Classes applicability (multi-select or "for all") + Inactive.
// ============================================================================

export interface StockUnit {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  description: string | null;
  decimal_places: number;
  decimal_places_allowed: number;
  unit_code: string | null;
  for_all_item_classes: boolean;
  item_classes: string[];
  is_fabric: boolean;
  is_yarn: boolean;
  is_sewing: boolean;
  is_packing: boolean;
  is_general: boolean;
  is_garment: boolean;
  /** Created Date / Created User. `uoms` had neither column until 0404 — 0383
   *  skipped every table with no `created_at`, which is why this master showed
   *  no Created pair at all while every call site was correctly wired. Null on
   *  rows predating 0404; deliberately not backfilled. */
  created_at?: string | null;
  created_by?: string | null;
}

export const stockUnitInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: capsName(),
  description: z.string().optional().nullable(),
  decimal_places: z.coerce.number().int().min(0).max(6).default(0),
  decimal_places_allowed: z.coerce.number().int().min(0).max(9).default(2),
  unit_code: z.string().optional().nullable(),
  for_all_item_classes: z.boolean().default(true),
  item_classes: z.array(z.string()).default([]),
  is_fabric: z.boolean().default(false),
  is_yarn: z.boolean().default(false),
  is_sewing: z.boolean().default(false),
  is_packing: z.boolean().default(false),
  is_general: z.boolean().default(false),
  is_garment: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type StockUnitInput = z.infer<typeof stockUnitInput>;
