import { z } from "zod";

// ============================================================================
// Material Attributes — master-detail (0222). Header = Item Class (→
// config_lookups kind `item_class`) + Category (→ `categories`, scoped to
// that Item Class); lines = per-attribute (→ `attributes`, also scoped to
// that Item Class) value specs (range / step / unit / mandatory / inactive).
// ============================================================================

/** A pre-defined value for an attribute line (legacy nested grid), used when the
 *  line is NOT Value-In-Steps — the Material form picks from these descriptions. */
export interface MaterialAttributeLineOption {
  id: string;
  material_attribute_line_id: string;
  sno: number;
  description: string;
  blocked: boolean;
}

export interface MaterialAttributeLine {
  id: string;
  material_attribute_id: string;
  sno: number;
  attribute_id: string | null;
  value_in_steps: boolean;
  start_value: number | null;
  end_value: number | null;
  unit_id: string | null;
  /** 0350: free-text suffix printed on each generated step value ("10 MM").
   *  Superseded `unit_id` — the unit was never converted by, only printed
   *  (client 2026-07-28). `unit_id` is kept so pre-0350 rows round-trip. */
  unit_label: string | null;
  step_value: number | null;
  mandatory: boolean;
  inactive: boolean;
  /** Per-line pre-defined values (0346). Empty when the line is Value-In-Steps. */
  options: MaterialAttributeLineOption[];
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

export const materialAttributeLineOptionInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  description: z.string().trim().min(1),
  blocked: z.boolean().default(false),
});

export const materialAttributeLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  attribute_id: z.string().uuid().nullable().default(null),
  value_in_steps: z.boolean().default(false),
  start_value: num,
  end_value: num,
  unit_id: z.string().uuid().nullable().default(null),
  unit_label: z.string().trim().nullable().default(null),
  step_value: num,
  mandatory: z.boolean().default(false),
  inactive: z.boolean().default(false),
  options: z.array(materialAttributeLineOptionInput).default([]),
});

export const materialAttributeInput = z.object({
  // MANDATORY: the pair IS this record's identity — `uq_material_attributes_
  // class_category` (0347) is unique on exactly these two, and the whole point of
  // the row is to say "for this Item Class and Category, ask these questions".
  // Neither could be null and mean anything.
  //
  // The screen has always gated Save on both, so nothing about the UI changes;
  // what changes is that the SERVER now agrees, which is what `lib/data-io`
  // imports go through. They previously defaulted to null and wrote a row whose
  // unique key was (null, null).
  item_class_id: z.string().uuid("Item Class is required"),
  category_id: z.string().uuid("Category is required"),
  name_separator: z.string().default(" "),
  lines: z.array(materialAttributeLineInput).default([]),
});
export type MaterialAttributeInput = z.infer<typeof materialAttributeInput>;
