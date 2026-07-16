import { z } from "zod";
import { nullableFormat, HSN_RE } from "@/lib/validation/formats";

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
  /** Links this blend row to an actual Yarn `items` record — client walkthrough:
   *  "we take the master-based cotton... we get the cardinal cotton" (0279). */
  component_item_id: string | null;
  count_id: string | null;
  blend_pct: number | null;
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
  is_active: boolean; // Inactive = !is_active
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
  /** Fabric type (Melange/Yarn-dyed/Grey, kind `fabric_type`) — Fabric only. */
  fabric_type_id: string | null;
  /** Yarn type (Grey/Melange/Doubling, kind `yarn_type`) — Yarn only. */
  yarn_type_id: string | null;
  ply: number | null;
  /** Fabric bought finished from a vendor — skips the yarn-composition
   *  requirement entirely (functional spec, 0280). Fabric only. */
  direct_purchase: boolean;
  base_uom_id: string | null;
  stock_uom_id: string | null;
  billing_uom_id: string | null;
  planning_uom_id: string | null;
  purchase_uom_id: string | null;
  cost_head_id: string | null;
  budget_rate: number | null;
  budget_rate_uom_id: string | null;
  created_at: string;
  created_by: string | null;
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

// "Type" is a selection-only dropdown.
export const MATERIAL_TYPES = ["Production", "Purchased", "Converted"] as const;

export type MaterialForm = { fields: DetailFieldKey[]; mixing: boolean };

/** A = Button/Capital/General/Sewing/Packing, C = Garments — both still generic,
 *  switch-rendered. Fabric and Yarn diverged too far (structure inheritance,
 *  nature-driven branching, %-mixing) for the generic switch — they get their
 *  own dedicated form components in the screen (0279). */
export const MATERIAL_FORMS: Record<"A" | "C", MaterialForm> = {
  A: { fields: ["category_id", "user_defined", "material_type", "specifications", "short_spec"], mixing: false },
  C: { fields: ["category_id", "user_defined", "material_type"], mixing: false },
};

export type MaterialFormKey = "A" | "FABRIC" | "YARN" | "C";

/** Map an item-class CODE to its Details form (unknown/new classes → A). */
export function itemClassForm(code: string | null | undefined): MaterialFormKey {
  switch ((code ?? "").toUpperCase()) {
    case "FABRIC":
      return "FABRIC";
    case "YARN":
      return "YARN";
    case "GAR":
      return "C";
    default:
      return "A";
  }
}

// ---------------------------------------------------------------------------
// Fabric structure → UOM auto-derivation (client walkthrough + discussion.md:
// Circular Knit = KG; Flat Knit = Numbers + Weight, e.g. 10 collars = 1 KG;
// Woven = Meters + KG). Structure lives on Category (0279), Material just
// reads it. Codes match config_lookups kind `fabric_structure`, seeded from
// the same values as the existing `styles.fabric_type` CHECK.
// ---------------------------------------------------------------------------
export const FABRIC_STRUCTURE_UOM: Record<string, { base: string; secondary?: string }> = {
  circular: { base: "kg" },
  flat_knit: { base: "nos", secondary: "kg" },
  woven: { base: "mtr", secondary: "kg" },
};

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
  component_item_id: uuidN,
  count_id: uuidN,
  blend_pct: numN,
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
  hsn_code: nullableFormat(HSN_RE, "HSN/SAC must be 4, 6 or 8 digits"),
  hsn_id: uuidN,
  category_id: uuidN,
  material_type: z.string().optional().nullable(),
  user_defined: z.boolean().default(false),
  specifications: z.string().optional().nullable(),
  short_spec: z.string().optional().nullable(),
  count_id: uuidN,
  purity_id: uuidN,
  shade: z.string().optional().nullable(),
  fabric_type_id: uuidN,
  yarn_type_id: uuidN,
  ply: z.coerce.number().int().positive().nullable().default(null),
  direct_purchase: z.boolean().default(false),
  base_uom_id: uuidN,
  stock_uom_id: uuidN,
  billing_uom_id: uuidN,
  planning_uom_id: uuidN,
  purchase_uom_id: uuidN,
  cost_head_id: uuidN,
  budget_rate: z.coerce.number().nonnegative().nullable().default(null),
  budget_rate_uom_id: uuidN,
  mixings: z.array(mixingInput).default([]),
  conversions: z.array(conversionInput).default([]),
}).refine(
  (d) => {
    const pcts = d.mixings.map((m) => m.blend_pct).filter((v): v is number => v != null);
    if (pcts.length === 0) return true;
    const sum = pcts.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 100) < 0.01;
  },
  { message: "Mixing percentages must add up to exactly 100%", path: ["mixings"] },
);
export type MaterialInput = z.infer<typeof materialInput>;
