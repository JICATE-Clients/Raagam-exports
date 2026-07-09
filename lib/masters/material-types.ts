import { z } from "zod";

// ============================================================================
// Material — the rich master over `items` (0226). Header (Item Class + HSN) +
// UOM tab (common) + a Details tab that varies per Item Class. The 8 classes
// map to 3 Details layouts (A/B/C).
// ============================================================================

export interface MaterialMixing {
  id: string;
  item_id: string;
  sno: number;
  description: string | null;
  shade: string | null;
  uom_id: string | null;
}
export interface MaterialUomConversion {
  id: string;
  item_id: string;
  sno: number;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
}

export interface Material {
  id: string;
  code: string; // Short Name
  name: string;
  is_active: boolean; // Blocked = !is_active
  item_class_id: string | null;
  hsn_code: string | null;
  hsn_id: string | null;
  category_id: string | null;
  material_type: string | null;
  user_defined: boolean;
  specifications: string | null;
  short_spec: string | null;
  count_id: string | null;
  purity_id: string | null;
  shade: string | null;
  base_uom_id: string | null;
  stock_uom_id: string | null;
  billing_uom_id: string | null;
  planning_uom_id: string | null;
  purchase_uom_id: string | null;
  cost_head_id: string | null;
  budget_rate: number | null;
  budget_rate_uom_id: string | null;
  mixings: MaterialMixing[];
  conversions: MaterialUomConversion[];
}

// ---------------------------------------------------------------------------
// Per-class Details form registry
// ---------------------------------------------------------------------------
export type DetailFieldKey =
  | "category_id"
  | "material_type"
  | "user_defined"
  | "specifications"
  | "short_spec"
  | "count_id"
  | "purity_id"
  | "shade";

// "Type" is a selection-only dropdown. Provisional list — extend once the full
// legacy Type options are confirmed (Garments showed "Production").
export const MATERIAL_TYPES = ["Production"] as const;

export type MaterialForm = { fields: DetailFieldKey[]; mixing: boolean };

/** A = Button/Capital/General/Sewing/Packing, B = Fabric/Yarn, C = Garments. */
export const MATERIAL_FORMS: Record<"A" | "B" | "C", MaterialForm> = {
  A: { fields: ["category_id", "user_defined", "material_type", "specifications", "short_spec"], mixing: false },
  B: { fields: ["material_type", "count_id", "category_id", "purity_id", "shade"], mixing: true },
  C: { fields: ["category_id", "user_defined", "material_type"], mixing: false },
};

/** Map an item-class CODE to its Details form (unknown/new classes → A). */
export function itemClassForm(code: string | null | undefined): "A" | "B" | "C" {
  switch ((code ?? "").toUpperCase()) {
    case "FABRIC":
    case "YARN":
      return "B";
    case "GAR":
      return "C";
    default:
      return "A";
  }
}

// ---------------------------------------------------------------------------
// Zod input
// ---------------------------------------------------------------------------
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const mixingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  description: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  uom_id: uuidN,
});
export const conversionInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  alt_qty: numN,
  alt_uom_id: uuidN,
  base_qty: numN,
  base_uom_id: uuidN,
});

export const materialInput = z.object({
  code: z.string().min(1, "Short Name is required"),
  name: z.string().optional().nullable(), // falls back to code
  is_active: z.boolean().default(true),
  item_class_id: uuidN,
  hsn_code: z.string().optional().nullable(),
  hsn_id: uuidN,
  category_id: uuidN,
  material_type: z.string().optional().nullable(),
  user_defined: z.boolean().default(false),
  specifications: z.string().optional().nullable(),
  short_spec: z.string().optional().nullable(),
  count_id: uuidN,
  purity_id: uuidN,
  shade: z.string().optional().nullable(),
  base_uom_id: uuidN,
  stock_uom_id: uuidN,
  billing_uom_id: uuidN,
  planning_uom_id: uuidN,
  purchase_uom_id: uuidN,
  cost_head_id: uuidN,
  budget_rate: numN,
  budget_rate_uom_id: uuidN,
  mixings: z.array(mixingInput).default([]),
  conversions: z.array(conversionInput).default([]),
});
export type MaterialInput = z.infer<typeof materialInput>;
