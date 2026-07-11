import { z } from "zod";

// ============================================================================
// Garment Orders ▸ Material BOM Amendment (0265). Header + two child grids
// (Items, Processes). "Calculated Quantities" is a read-only projection (no
// table). Icon fields reference customers / sales_orders / items / vendors /
// uoms / config_lookups. See doc/masters-open-questions.md for the provisional
// columns (Type / Supply Type / Combination) and the Calc-Qty formula.
// ============================================================================

// Provisional fixed dropdowns — no legacy option list captured yet (confirm).
export const MATERIAL_TYPE_OPTIONS = ["Production", "Sample", "Trial"] as const;
export const SUPPLY_TYPE_OPTIONS = ["Local", "Import", "Nominated", "Free Issue"] as const;

export interface MbaItem {
  id: string;
  amendment_id: string;
  sno: number;
  category_id: string | null;
  type: string | null;
  item_id: string | null;
  attribute_id: string | null;
  supply_type: string | null;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  alternate_uom_id: string | null;
  combination: string | null;
  moq: number | null;
  quantity_nos: number | null;
}

export interface MbaProcess {
  id: string;
  amendment_id: string;
  sno: number;
  item_id: string | null;
}

export interface MaterialBomAmendment {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  amendment_no: number;
  amend_date: string;
  is_draft: boolean;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  sales_orders?: { id: string; order_number: string | null; order_qty: number } | null;
  customer?: { id: string; code: string | null; name: string } | null;
  items: MbaItem[];
  processes: MbaProcess[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const mbaItemInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  category_id: uuidN,
  type: nullableText,
  item_id: uuidN,
  attribute_id: uuidN,
  supply_type: nullableText,
  vendor_id: uuidN,
  purchase_uom_id: uuidN,
  consumption_uom_id: uuidN,
  alternate_uom_id: uuidN,
  combination: nullableText,
  moq: numN,
  quantity_nos: numN,
});

export const mbaProcessInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  item_id: uuidN,
});

export const materialBomAmendmentInput = z.object({
  sales_order_id: uuidN,
  customer_id: uuidN,
  amend_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remarks: nullableText,
  // children
  items: z.array(mbaItemInput).default([]),
  processes: z.array(mbaProcessInput).default([]),
});
export type MaterialBomAmendmentInput = z.infer<typeof materialBomAmendmentInput>;

export function mbaStatusTone(is_draft: boolean): "warning" | "success" {
  return is_draft ? "warning" : "success";
}
export function mbaStatusText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/** One read-only row of the "Calculated Quantities" tab. */
export type CalculatedQtyRow = {
  sno: number;
  category: string;
  description: string;
  process: string;
  size: string;
  uom: string;
  calc_qty: number | null;
  order_qty: number;
};
