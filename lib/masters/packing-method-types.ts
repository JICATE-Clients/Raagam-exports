import { z } from "zod";

// ============================================================================
// Packing Methods — parent-child master (Materials submodule).
// Parent: packing_methods (packing_type, reference, description,
//         packing_charges, effective_from, inactive).
// Child:  packing_method_categories (sort_order, category_name).
// ============================================================================

export interface PackingMethodCategory {
  id: string;
  sort_order: number | null;
  category_name: string;
}

export interface PackingMethod {
  id: string;
  packing_type: string;
  reference: string | null;
  description: string | null;
  packing_charges: number | null;
  effective_from: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  categories?: PackingMethodCategory[];
}

export const packingMethodInput = z.object({
  packing_type: z.string().min(1, "Packing type is required"),
  reference: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  packing_charges: z.number().optional().nullable(),
  effective_from: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type PackingMethodInput = z.infer<typeof packingMethodInput>;
