import { z } from "zod";

// ============================================================================
// Product Types — master (product_types). Simple code + name master.
// ============================================================================
export interface ProductType {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const productTypeInput = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  is_active: z.boolean().default(true),
});
export type ProductTypeInput = z.infer<typeof productTypeInput>;
