import { z } from "zod";

// ============================================================================
// Material Attributes — master-detail (0222). Header = Item Class (→
// config_lookups kind `item_class`) + Category (→ `categories`, scoped to
// that Item Class); lines = per-attribute (→ `attributes`, also scoped to
// that Item Class) value specs (range / step / unit / mandatory / inactive).
// ============================================================================

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
  inactive: boolean;
}

export interface MaterialAttribute {
  id: string;
  item_class_id: string | null;
  category_id: string | null;
  /** 0341: separator used to join chosen attribute answers into the auto item name. */
  name_separator: string;
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
  inactive: z.boolean().default(false),
});

export const materialAttributeInput = z.object({
  item_class_id: z.string().uuid().nullable().default(null),
  category_id: z.string().uuid().nullable().default(null),
  name_separator: z.string().default(" "),
  lines: z.array(materialAttributeLineInput).default([]),
});
export type MaterialAttributeInput = z.infer<typeof materialAttributeInput>;
