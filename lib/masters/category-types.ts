import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Categories — rich material-classification master (0223). Legacy EDP2
// "Category" form: a required Item Class (→ config_lookups kind item_class) with
// descriptive fields, a Made origin, and optional Levy / Commodity references.
// ============================================================================
export const MADE_TYPES = ["Natural", "Manmade", "Mixed"] as const;
export type MadeType = (typeof MADE_TYPES)[number];

/** A second classification level under a Category (0349) — e.g. ELECTRICAL ▸
 *  LIGHTS / FANS / SWITCHES. Exists so General spend can be reported both in
 *  detail and as a category total. */
export interface CategorySubCategory {
  id: string;
  category_id: string;
  sno: number;
  name: string;
}

export interface Category {
  id: string;
  item_class_id: string;
  short_name: string | null;
  name: string | null;
  short_spec: string | null;
  made: MadeType | null;
  levy_id: string | null;
  commodity_id: string | null;
  /** Fabric structure (Circular/Flat/Woven, kind `fabric_structure`) — set once
   *  per category and inherited by every Material in it, never re-picked per item. */
  fabric_structure_id: string | null;
  /** Costing percentages — set at category level and used in pricing/costing
   *  calculations downstream (mirror of legacy FrmItemCategory fields). */
  wastage_per: number | null;
  profit_per: number | null;
  freight_per: number | null;
  insurance_per: number | null;
  interest_per: number | null;
  /** FK to size_groups — the default size group for items in this category. */
  size_group_id: string | null;
  /** Free-text status monitoring classification. */
  status_monitoring_type: string | null;
  /** Legacy "User Defined" Yes/No flag — inert, stored as-is (same as the
   *  Materials master's own `user_defined` field; see doc/masters-open-questions.md #6).
   *  Only shown on the form for USER_DEFINED_CLASS_CODES item classes. */
  user_defined: boolean;
  inactive: boolean;
  /** Reveals the Sub Categories grid. When false the category has no second
   *  level and the Material form hides its Sub Category field entirely. */
  has_sub_categories: boolean;
  sub_categories: CategorySubCategory[];
  /** Who entered the record — joined in category-service, not a raw column read. */
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** `id` is carried back on save so updateCategory can RECONCILE rather than
 *  delete-and-reinsert. Every other child grid in this codebase replaces its
 *  rows wholesale, which is fine when nothing points at them — but
 *  items.sub_category_id does, so regenerating ids on every category save
 *  would break the link on every material in that category. Null = a new row. */
export const categorySubCategoryInput = z.object({
  id: z.string().uuid().nullable().default(null),
  sno: z.coerce.number().int().nonnegative().default(0),
  name: capsName("Sub Category name is required"),
});

export const categoryInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  name: capsTextNullable(),
  short_spec: z.string().optional().nullable(),
  made: z.enum(MADE_TYPES).nullable().default(null),
  levy_id: z.string().uuid().nullable().default(null),
  commodity_id: z.string().uuid().nullable().default(null),
  fabric_structure_id: z.string().uuid().nullable().default(null),
  wastage_per: z.coerce.number().default(0),
  profit_per: z.coerce.number().default(0),
  freight_per: z.coerce.number().default(0),
  insurance_per: z.coerce.number().default(0),
  interest_per: z.coerce.number().default(0),
  size_group_id: z.string().uuid().nullable().default(null),
  status_monitoring_type: z.string().nullable().default(null),
  user_defined: z.boolean().default(false),
  inactive: z.boolean().default(false),
  has_sub_categories: z.boolean().default(false),
  sub_categories: z.array(categorySubCategoryInput).default([]),
});
export type CategoryInput = z.infer<typeof categoryInput>;

// Item classes whose Category form shows the "User Defined" field. Fabric/Yarn
// never showed it; Capital Goods and General were dropped too (client
// 2026-07-30) — the flag only earns its place where it flips a name between
// free text and the configured attribute questions (Sewing/Packing) or is read
// back on the Garments form. The `user_defined` column still exists and
// round-trips; it simply defaults to false for those classes and is not asked.
export const USER_DEFINED_CLASS_CODES = new Set(["SEW", "PACK", "GAR"]);
export function showsUserDefined(code: string | null | undefined): boolean {
  return !!code && USER_DEFINED_CLASS_CODES.has(code.toUpperCase());
}

/** Item classes whose Categories can carry a second level (0349). General
 *  stores buy by category-then-type — Electrical ▸ Lights/Fans/Switches — and
 *  need both the detail and the roll-up for annual spend reporting.
 *
 *  General only for now (client 2026-07-28). Capital Goods was in the original
 *  spec and is the obvious next addition: add "CAP" here and both the Category
 *  grid and the Material field follow, no other change. */
export const SUB_CATEGORY_CLASS_CODES = new Set(["GEN"]);
export function showsSubCategories(code: string | null | undefined): boolean {
  return !!code && SUB_CATEGORY_CLASS_CODES.has(code.toUpperCase());
}
