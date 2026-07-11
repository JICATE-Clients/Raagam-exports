import { z } from "zod";

// ============================================================================
// Garment Orders ▸ Style master (0124). Header + three child grids
// (Coordinates, Components, Sizes). Icon fields reference customers / countries /
// uoms / samples / customer_contacts / config_lookups.
// ============================================================================

// Fixed dropdowns — legacy option lists (confirm exact values via screenshots).
export const STYLE_FOR_OPTIONS = ["Garments", "Fabric", "Made-ups"] as const;
export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;
export const TECH_PACK_OPTIONS = ["Not Required", "Required", "Received"] as const;
export const COMPONENT_TYPE_OPTIONS = ["Circular", "Flat"] as const;
export const RECEIPT_MODE_OPTIONS = ["By Mail", "By Hand", "Courier", "Email"] as const;

export interface GarmentStyleCoordinate {
  id: string;
  style_id: string;
  sno: number;
  coordinate_id: string | null;
  mlist_no: string | null;
}

export interface GarmentStyleComponent {
  id: string;
  style_id: string;
  sno: number;
  coordinate_id: string | null;
  component_id: string | null;
  structure_id: string | null;
  comp_type: string | null;
  trims: boolean;
  trims_category_id: string | null;
}

export interface GarmentStyleSize {
  id: string;
  style_id: string;
  sno: number;
  size_id: string | null;
}

export interface GarmentStyle {
  id: string;
  code: string | null;
  blocked: boolean;
  style_date: string;
  style_for: string | null;
  customer_id: string | null;
  approved_sample_id: string | null;
  style_name: string | null;
  season: string | null;
  style_year: number | null;
  article_no: string | null;
  style_category_id: string | null;
  style_description: string | null;
  tech_pack: string | null;
  unit_id: string | null;
  country_id: string | null;
  department_id: string | null;
  contact_id: string | null;
  customer_reference: string | null;
  received_date: string | null;
  receipt_mode: string | null;
  description: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  customer?: { id: string; code: string | null; name: string } | null;
  coordinates: GarmentStyleCoordinate[];
  components: GarmentStyleComponent[];
  sizes: GarmentStyleSize[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const styleCoordinateInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  mlist_no: nullableText,
});

export const styleComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  component_id: uuidN,
  structure_id: uuidN,
  comp_type: nullableText,
  trims: z.boolean().default(false),
  trims_category_id: uuidN,
});

export const styleSizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  size_id: uuidN,
});

export const garmentStyleInput = z.object({
  blocked: z.boolean().default(false),
  style_date: z.string().min(1, "Date is required"),
  style_for: nullableText,
  customer_id: uuidN,
  approved_sample_id: uuidN,
  style_name: z.string().min(1, "Style name is required"),
  season: nullableText,
  style_year: z.coerce.number().int().nullable().default(null),
  article_no: nullableText,
  style_category_id: uuidN,
  style_description: nullableText,
  tech_pack: nullableText,
  unit_id: uuidN,
  country_id: uuidN,
  department_id: uuidN,
  contact_id: uuidN,
  customer_reference: nullableText,
  received_date: nullableText,
  receipt_mode: nullableText,
  description: nullableText,
  is_draft: z.boolean().default(false),
  // children
  coordinates: z.array(styleCoordinateInput).default([]),
  components: z.array(styleComponentInput).default([]),
  sizes: z.array(styleSizeInput).default([]),
});
export type GarmentStyleInput = z.infer<typeof garmentStyleInput>;

export function styleStatusTone(
  s: Pick<GarmentStyle, "is_draft" | "blocked">,
): "warning" | "danger" | "success" {
  return s.is_draft ? "warning" : s.blocked ? "danger" : "success";
}
export function styleStatusText(
  s: Pick<GarmentStyle, "is_draft" | "blocked">,
): string {
  return s.is_draft ? "Draft" : s.blocked ? "Blocked" : "Active";
}
