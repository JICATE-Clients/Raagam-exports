import { z } from "zod";
import { nullableFormat, HSN_RE, capsTextNullable } from "@/lib/validation/formats";

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
/** "Using (Items)" grid — General item class only (0304): which other items
 *  (any class) this material uses, plus Shade/UOM per line. */
export interface MaterialUsingItem {
  id: string;
  item_id: string;
  sno: number;
  used_item_id: string | null;
  description: string | null;
  shade: string | null;
  uom_id: string | null;
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
  /** Second classification level under the Category — General only (0349).
   *  e.g. Category ELECTRICAL ▸ Sub Category LIGHTS. Null when the category
   *  defines no sub-categories, which is the normal case for every other class. */
  sub_category_id: string | null;
  /** Legacy "Type" — for SEW/PACK it is the accessory Transaction Type
   *  (Purchased / Converted; Production filtered out in the form). General
   *  never asks for it and always stores "Purchased" (client 2026-07-28). */
  material_type: string | null;
  /** General item class only (0350) — the kind of thing (BRUSH, PEN, CABLE) and
   *  the specific item (NYLON 4 INCH). Free text; the third and fourth segments
   *  of the auto-composed Name. Null for every other class. */
  item_type_name: string | null;
  item_base_name: string | null;
  user_defined: boolean;
  specifications: string | null;
  short_spec: string | null;
  count_id: string | null;
  purity_id: string | null;
  shade: string | null;
  /** Fabric type (Melange/Yarn-dyed/Grey, kind `fabric_type`) — Fabric only. */
  fabric_type_id: string | null;
  /** Fabric "Type" in the legacy sense — Circular Knit/Flat Knit/Woven, kind
   *  `fabric_structure` — Fabric only. A direct field on the material; drives
   *  UOM auto-derivation on change (0301). Distinct from `category_id`, which
   *  on Fabric holds the legacy "Structure" (e.g. "1X1 FANCY RIB" — a specific
   *  knit/weave pattern, still labeled "Structure" in the Fabric Details UI). */
  fabric_structure_id: string | null;
  /** Fabric "Using" — Single Yarn / Multiple Yarn, free values (see
   *  `FABRIC_USING`). Fabric only, stored as-is (no behavior tied to it). */
  fabric_using: string | null;
  /** Yarn type (Grey/Melange/Twisted/Doubling, kind `yarn_type`) — Yarn only. */
  yarn_type_id: string | null;
  /** Fabric bought finished from a vendor — skips the yarn-composition
   *  requirement entirely (functional spec, 0280). Fabric only. */
  direct_purchase: boolean;
  /** This material is bought in a different unit than it is consumed in —
   *  thread consumed in metres but purchased in cones, buttons consumed in
   *  numbers but purchased in gross (0348). ~90% of materials are false, and
   *  for those the four slots below all equal `base_uom_id` and `conversions`
   *  is empty (the server enforces both). */
  has_alternate_uom: boolean;
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
  using_items: MaterialUsingItem[];
  item_attribute_values: { id: string; attribute_line_id: string | null; sno: number; value: string | null }[];
}

// ---------------------------------------------------------------------------
// Per-class Details form registry
// ---------------------------------------------------------------------------
export type DetailFieldKey =
  | "category_id"
  | "sub_category_id"
  | "item_type_name"
  | "item_base_name"
  | "material_type"
  | "specifications"
  | "short_spec"
  | "count_id"
  | "purity_id"
  | "shade";

// "Type" is a selection-only dropdown.
export const MATERIAL_TYPES = ["Production", "Purchased", "Converted"] as const;

// Fabric "Using" — legacy fixed-choice dropdown (0302).
export const FABRIC_USING = ["Single Yarn", "Multiple Yarn"] as const;

export type MaterialForm = { fields: DetailFieldKey[]; mixing: boolean };

/** A = Button/Capital/Sewing/Packing, GEN = General, C = Garments — all still
 *  generic, switch-rendered. Fabric and Yarn diverged too far (structure
 *  inheritance, nature-driven branching, %-mixing) for the generic switch — they
 *  get their own dedicated form components in the screen (0279). */
// Form A (Button/Capital/Sewing/Packing): Category + Transaction Type.
// Description/Short-Spec dropped from the UI (client 2026-07-25 — the item name
// comes from the attributes, not a free-text description); the
// specifications/short_spec DB columns are kept for round-trip. "User defined"
// was dropped on 2026-07-30 — see the note on form C below.
// `sub_category_id` sits right after the Category it hangs off. Only the classes
// in SUB_CATEGORY_CLASS_CODES (category-types.ts) show it, so the screen filters
// it out of this list rather than the registry carrying two variants of form A
// (see the fields.filter at the Classification section). It stays in A for the
// day Capital Goods joins that set — today only GEN below actually renders it.
// Form GEN (General) split out of A on 2026-07-28. A consumable is identified by
// Category ▸ Sub Category ▸ Item Type ▸ Item Name, and the Name is composed from
// exactly those four — nothing is typed by hand. The two fields A shows are noise
// here: the Transaction Type only ever has one answer, since a consumable is
// always bought (the screen sends "Purchased" silently). The column still
// round-trips; it is simply not asked for.
// Form C (Garments) is deliberately SHORTER than A. A garment is identified by
// its category and its name and nothing else — the client asked for "Category
// Name and Item Name", with none of the consumption/conversion modelling that
// sewing thread or buttons need, and no Transaction Type (client 2026-07-28).
// "USER DEFINED" IS GONE FROM ALL THREE FORMS (client 2026-07-30). It was a
// Yes/No asked on the Category and echoed read-only here to explain why the
// Attributes grid had appeared. The client's answer to "what does it do?" was to
// remove it. `categories.user_defined` and `items.user_defined` still exist and
// still round-trip; no row has ever been set to true, so nothing about the
// attribute flow changes — see the note at `attributeDriven` in
// material-master-screen.tsx.
export const MATERIAL_FORMS: Record<"A" | "GEN" | "C", MaterialForm> = {
  A: { fields: ["category_id", "sub_category_id", "material_type"], mixing: false },
  GEN: { fields: ["category_id", "sub_category_id", "item_type_name", "item_base_name"], mixing: false },
  C: { fields: ["category_id"], mixing: false },
};

export type MaterialFormKey = "A" | "FABRIC" | "YARN" | "GEN" | "C";

/** Map an item-class CODE to its Details form (unknown/new classes → A). */
export function itemClassForm(code: string | null | undefined): MaterialFormKey {
  switch ((code ?? "").toUpperCase()) {
    case "FABRIC":
      return "FABRIC";
    case "YARN":
      return "YARN";
    case "GEN":
      return "GEN";
    case "GAR":
      return "C";
    default:
      return "A";
  }
}

/** Sewing and Packing are the accessory classes: their materials are named from
 *  the Material Attribute questions configured per (Item Class + Category), and
 *  their "Type" is a Transaction Type (Purchased/Converted, no Production).
 *
 *  Do NOT infer this from `itemClassForm() === "A"`. Form A is the *default*
 *  bucket above, so Capital Goods lands in it too (as General did until it got
 *  its own form) — and that is exactly how they picked up an attribute flow they
 *  have no config for, which disabled their Save and made their Name read-only,
 *  leaving no way to create one at all (client 2026-07-28). `formKey === "A"`
 *  means "not Fabric/Yarn/General/Garments", never "is an accessory". */
export const ACCESSORY_CLASS_CODES = new Set(["SEW", "PACK"]);
export function isAccessoryClass(code: string | null | undefined): boolean {
  return !!code && ACCESSORY_CLASS_CODES.has(code.toUpperCase());
}

/** Classes counted in whole units, so every UOM prefills to Numbers: accessories
 *  are counted, and garments are handled as pieces (client 2026-07-28).
 *
 *  Deliberately a SEPARATE set from ACCESSORY_CLASS_CODES rather than adding
 *  "GAR" to it. That set does double duty — it also switches on the
 *  attribute-driven naming flow — so widening it to reach the UOM default would
 *  silently hand Garments the Material Attribute question grid and a read-only
 *  auto-composed Name, which is the exact opposite of what Garments is for. Two
 *  meanings, two sets. */
export const NUMBERS_UOM_CLASS_CODES = new Set(["SEW", "PACK", "GAR"]);
export function usesNumbersUom(code: string | null | undefined): boolean {
  return !!code && NUMBERS_UOM_CLASS_CODES.has(code.toUpperCase());
}

// ---------------------------------------------------------------------------
// Fabric structure → default UOM (client 2026-07-24): a single default unit per
// structure — Circular Knit = KGS, Flat Knit = KGS, Woven = MTR — applied like
// the Yarn kg default: prefilled on the material and freely overridable. (Earlier
// Flat = Numbers+Weight / Woven = Meters+KG dual units were dropped per the
// client's single-unit spec.) Structure lives on Category (0279), Material just
// reads it. Codes match config_lookups kind `fabric_structure`, seeded from the
// same values as the existing `styles.fabric_type` CHECK. The optional
// `secondary` stays in the shape for any future dual-unit structure.
// ---------------------------------------------------------------------------
export const FABRIC_STRUCTURE_UOM: Record<string, { base: string; secondary?: string }> = {
  circular: { base: "kg" },
  flat_knit: { base: "kg" },
  woven: { base: "mtr" },
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
export const usingItemInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  used_item_id: uuidN,
  description: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  uom_id: uuidN,
});
export const itemAttributeValueInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  attribute_line_id: z.string().uuid().nullable().default(null),
  value: z.string().nullable().default(null),
});

export const materialInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: capsTextNullable(), // falls back to code
  is_active: z.boolean().default(true),
  item_class_id: uuidN,
  hsn_code: nullableFormat(HSN_RE, "HSN/SAC must be 4, 6 or 8 digits"),
  hsn_id: uuidN,
  category_id: uuidN,
  sub_category_id: uuidN,
  // General only (0350) — the Name is composed from these, but they are stored
  // in their own columns so an edit re-opens with the parts, not a split string.
  item_type_name: z.string().optional().nullable(),
  item_base_name: z.string().optional().nullable(),
  material_type: z.string().optional().nullable(),
  user_defined: z.boolean().default(false),
  specifications: z.string().optional().nullable(),
  short_spec: z.string().max(200, "Short spec max 200 chars").optional().nullable(),
  count_id: uuidN,
  purity_id: uuidN,
  shade: z.string().optional().nullable(),
  fabric_type_id: uuidN,
  fabric_structure_id: uuidN,
  fabric_using: z.string().optional().nullable(),
  yarn_type_id: uuidN,
  direct_purchase: z.boolean().default(false),
  has_alternate_uom: z.boolean().default(false),
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
  using_items: z.array(usingItemInput).default([]),
  item_attribute_values: z.array(itemAttributeValueInput).default([]),
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
