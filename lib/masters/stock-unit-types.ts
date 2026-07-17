import { z } from "zod";

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
}

export const stockUnitInput = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
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
