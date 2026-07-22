import { z } from "zod";

// ============================================================================
// Product Sizes — master (product_sizes). prod_size is display-only:
// "Width [x Length] [x Height]". size_for: P=Product, F=Fabric (F zeroes L/H).
// ============================================================================
export const SIZE_FOR = ["P", "F"] as const;
export type SizeFor = (typeof SIZE_FOR)[number];

export interface ProductSize {
  id: string;
  prod_size_id: string;
  width: number;
  length: number;
  height: number;
  prod_cut_size: string | null;
  size_for: SizeFor | null;
  desc1: string | null;
  desc2: string | null;
  desc3: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const productSizeInput = z.object({
  prod_size_id: z.string().min(1, "Size ID is required"),
  width: z.coerce.number().positive("Width must be greater than 0"),
  length: z.coerce.number().min(0, "Length must be 0 or greater").default(0),
  height: z.coerce.number().min(0, "Height must be 0 or greater").default(0),
  prod_cut_size: z.string().optional().nullable(),
  size_for: z.enum(SIZE_FOR).nullable().default(null),
  desc1: z.string().optional().nullable(),
  desc2: z.string().optional().nullable(),
  desc3: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ProductSizeInput = z.infer<typeof productSizeInput>;
