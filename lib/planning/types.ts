import { z } from "zod";

// re-use fabric vocab from sales (same domain)
export { FABRIC_TYPES, FABRIC_SUBTYPES } from "@/lib/sales/types";
import { FABRIC_TYPES, FABRIC_SUBTYPES } from "@/lib/sales/types";

export const BOM_STATUSES = ["draft", "final"] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

export const MATERIAL_CATEGORIES = [
  "sewing_accessory",
  "packing_accessory",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  sewing_accessory: "Sewing Accessory",
  packing_accessory: "Packing Accessory",
};

export const QUANTITY_BASES = ["nos", "moq"] as const;
export type QuantityBasis = (typeof QUANTITY_BASES)[number];

export const BUDGET_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_LINE_SOURCES = ["fabric", "material", "other"] as const;
export type BudgetLineSource = (typeof BUDGET_LINE_SOURCES)[number];

// ---------- interfaces ----------
export interface FabricBom {
  id: string;
  sales_order_id: string;
  style_id: string | null;
  fabric_type: (typeof FABRIC_TYPES)[number] | null;
  fabric_subtype: (typeof FABRIC_SUBTYPES)[number] | null;
  status: BomStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricBomComponent {
  id: string;
  fabric_bom_id: string;
  component_name: string;
  color: string | null;
  size: string | null;
  diameter: string | null;
  gsm: number | null;
  consumption: number;
  uom_id: string | null;
  process_loss_pct: number;
  net_consumption: number;
  sort_order: number;
}

export interface FabricBomProcess {
  id: string;
  fabric_bom_id: string;
  sequence: number;
  process_name: string;
  process_loss_pct: number;
  notes: string | null;
}

export interface MaterialBom {
  id: string;
  sales_order_id: string;
  status: BomStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialBomItem {
  id: string;
  material_bom_id: string;
  category: MaterialCategory;
  item_id: string | null;
  description: string;
  attribute: string | null;
  uom_id: string | null;
  quantity_basis: QuantityBasis;
  quantity_nos: number;
  moq: number | null;
  unit_cost: number;
  requires_processing: boolean;
  processing_note: string | null;
  sort_order: number;
}

export interface Budget {
  id: string;
  code: string | null;
  name: string;
  is_grouped: boolean;
  status: BudgetStatus;
  currency_code: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  sales_order_id: string | null;
  source: BudgetLineSource;
  description: string;
  quantity: number;
  unit_cost: number;
  amount: number;
  sort_order: number;
}

// ---------- input schemas ----------
export const fabricBomInput = z.object({
  sales_order_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  fabric_type: z.enum(FABRIC_TYPES).optional().nullable(),
  fabric_subtype: z.enum(FABRIC_SUBTYPES).optional().nullable(),
  status: z.enum(BOM_STATUSES).default("draft"),
  notes: z.string().optional().nullable(),
});
export type FabricBomInput = z.infer<typeof fabricBomInput>;

export const fabricComponentInput = z.object({
  component_name: z.string().min(1),
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  diameter: z.string().optional().nullable(),
  gsm: z.coerce.number().nonnegative().optional().nullable(),
  consumption: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  process_loss_pct: z.coerce.number().min(0).max(100).default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type FabricComponentInput = z.infer<typeof fabricComponentInput>;

export const fabricProcessInput = z.object({
  sequence: z.coerce.number().int().default(0),
  process_name: z.string().min(1),
  process_loss_pct: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional().nullable(),
});
export type FabricProcessInput = z.infer<typeof fabricProcessInput>;

export const materialBomInput = z.object({
  sales_order_id: z.string().uuid(),
  status: z.enum(BOM_STATUSES).default("draft"),
  notes: z.string().optional().nullable(),
});
export type MaterialBomInput = z.infer<typeof materialBomInput>;

export const materialItemInput = z.object({
  category: z.enum(MATERIAL_CATEGORIES).default("sewing_accessory"),
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  attribute: z.string().optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  quantity_basis: z.enum(QUANTITY_BASES).default("nos"),
  quantity_nos: z.coerce.number().nonnegative().default(0),
  moq: z.coerce.number().nonnegative().optional().nullable(),
  unit_cost: z.coerce.number().nonnegative().default(0),
  requires_processing: z.boolean().default(false),
  processing_note: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type MaterialItemInput = z.infer<typeof materialItemInput>;

export const budgetInput = z.object({
  name: z.string().min(1),
  is_grouped: z.boolean().default(false),
  currency_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sales_order_ids: z.array(z.string().uuid()).default([]),
});
export type BudgetInput = z.infer<typeof budgetInput>;

export const budgetLineInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  source: z.enum(BUDGET_LINE_SOURCES).default("other"),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  unit_cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type BudgetLineInput = z.infer<typeof budgetLineInput>;

// ---------- computations ----------
/** Gross-up consumption by process loss: net = gross * (1 + loss%). */
export function netConsumption(consumption: number, lossPct: number): number {
  return consumption * (1 + lossPct / 100);
}

/** Effective purchase qty: MOQ when basis is 'moq' (and MOQ set), else nos. */
export function effectiveMaterialQty(
  item: Pick<MaterialBomItem, "quantity_basis" | "quantity_nos" | "moq">,
): number {
  return item.quantity_basis === "moq" && item.moq != null
    ? item.moq
    : item.quantity_nos;
}

export function lineAmount(quantity: number, unitCost: number): number {
  return quantity * unitCost;
}
