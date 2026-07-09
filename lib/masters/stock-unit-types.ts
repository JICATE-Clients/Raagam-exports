import { z } from "zod";

// ============================================================================
// Stock Units — the enriched UOM master (0224 adds columns to `uoms`). Legacy
// EDP2 "Stock unit" form: Unit of Measurement + Description + No. of Decimal
// Places + Item Classes applicability (multi-select or "for all") + Blocked.
// ============================================================================

// NOTE: this 6-value list is what the legacy Stock Unit form shows — it differs
// from the 8-value ITEM_CLASSES used by Attributes/Material-Attribute (a legacy
// inconsistency). Stored as text[]; adjust if the picker differs.
export const STOCK_UNIT_ITEM_CLASSES = [
  "Yarn",
  "Fabric",
  "Sewing",
  "Packing",
  "Garments",
  "General",
] as const;
export type StockUnitItemClass = (typeof STOCK_UNIT_ITEM_CLASSES)[number];

export interface StockUnit {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  description: string | null;
  decimal_places: number;
  for_all_item_classes: boolean;
  item_classes: string[];
}

export const stockUnitInput = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  decimal_places: z.coerce.number().int().min(0).max(6).default(0),
  for_all_item_classes: z.boolean().default(true),
  item_classes: z.array(z.enum(STOCK_UNIT_ITEM_CLASSES)).default([]),
  is_active: z.boolean().default(true),
});
export type StockUnitInput = z.infer<typeof stockUnitInput>;
