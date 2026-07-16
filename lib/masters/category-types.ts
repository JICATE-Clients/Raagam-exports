import { z } from "zod";

// ============================================================================
// Categories — rich material-classification master (0223). Legacy EDP2
// "Category" form: a required Item Class (→ config_lookups kind item_class) with
// descriptive fields, a Made origin, and optional Levy / Commodity references.
// ============================================================================
export const MADE_TYPES = ["Natural", "Manmade", "Mixed"] as const;
export type MadeType = (typeof MADE_TYPES)[number];

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
  /** Legacy "User Defined" Yes/No flag — inert, stored as-is (same as the
   *  Materials master's own `user_defined` field; see doc/masters-open-questions.md #6).
   *  Only shown on the form for USER_DEFINED_CLASS_CODES item classes. */
  user_defined: boolean;
  inactive: boolean;
  /** Who entered the record — joined in category-service, not a raw column read. */
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export const categoryInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  short_spec: z.string().optional().nullable(),
  made: z.enum(MADE_TYPES).nullable().default(null),
  levy_id: z.string().uuid().nullable().default(null),
  commodity_id: z.string().uuid().nullable().default(null),
  fabric_structure_id: z.string().uuid().nullable().default(null),
  user_defined: z.boolean().default(false),
  inactive: z.boolean().default(false),
});
export type CategoryInput = z.infer<typeof categoryInput>;

// Item classes whose legacy Category form shows the "User Defined" field
// (Capital/General/Sewing/Packing/Garments) — Fabric/Yarn never show it.
export const USER_DEFINED_CLASS_CODES = new Set(["CAP", "GEN", "SEW", "PACK", "GAR"]);
export function showsUserDefined(code: string | null | undefined): boolean {
  return !!code && USER_DEFINED_CLASS_CODES.has(code.toUpperCase());
}
