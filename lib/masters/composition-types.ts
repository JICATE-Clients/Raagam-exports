import { z } from "zod";

// ============================================================================
// Compositions — master-detail (0225). Legacy EDP2 "Composition" form: header
// (Item Class → config_lookups item_class) with a "Mixing" grid of free-text
// fibre descriptions + their mixing %.
// ============================================================================
export interface CompositionLine {
  id: string;
  composition_id: string;
  sno: number;
  description: string;
  mixing_pct: number;
}
export interface Composition {
  id: string;
  item_class_id: string;
  short_name: string | null;
  name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  lines: CompositionLine[];
}

export const compositionLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  description: z.string().min(1),
  mixing_pct: z.coerce.number().min(0).default(0),
});
export const compositionInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
  lines: z.array(compositionLineInput).default([]),
});
export type CompositionInput = z.infer<typeof compositionInput>;
