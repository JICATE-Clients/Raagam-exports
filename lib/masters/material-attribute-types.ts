import { z } from "zod";

// ============================================================================
// Material Attributes — master-detail (0222). Header = Item Class + Category;
// lines = per-attribute value specs (range / step / unit / mandatory / blocked).
// ============================================================================

// NOTE: no "item class" master exists — this mirrors the fixed class list the
// Attributes master uses for `type`. Provisional; extend if the legacy picker differs.
export const ITEM_CLASSES = [
  "Yarn",
  "Fabric",
  "Sewing Accessories",
  "Packing Accessories",
  "General",
  "Garments",
  "Consumables",
  "Capital Items",
] as const;
export type ItemClass = (typeof ITEM_CLASSES)[number];

export interface MaterialAttributeLine {
  id: string;
  material_attribute_id: string;
  sno: number;
  attribute_id: string | null;
  value_in_steps: boolean;
  start_value: number | null;
  end_value: number | null;
  unit_id: string | null;
  step_value: number | null;
  mandatory: boolean;
  blocked: boolean;
}

export interface MaterialAttribute {
  id: string;
  item_class: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
  lines: MaterialAttributeLine[];
}

const num = z.coerce.number().nullable().default(null);

export const materialAttributeLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  attribute_id: z.string().uuid().nullable().default(null),
  value_in_steps: z.boolean().default(false),
  start_value: num,
  end_value: num,
  unit_id: z.string().uuid().nullable().default(null),
  step_value: num,
  mandatory: z.boolean().default(false),
  blocked: z.boolean().default(false),
});

export const materialAttributeInput = z.object({
  item_class: z.string().optional().nullable(),
  category_id: z.string().uuid().nullable().default(null),
  lines: z.array(materialAttributeLineInput).default([]),
});
export type MaterialAttributeInput = z.infer<typeof materialAttributeInput>;
