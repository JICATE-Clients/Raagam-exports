import { z } from "zod";

// ============================================================================
// Brands — Materials master (0278). Legacy EDP2 "Brand" form:
// Short Name · Name (req) · Country (opt → countries FK via ⓘ picker) ·
// Website · Phone · Fax · Blocked.
// ============================================================================
export interface Brand {
  id: string;
  brand_short_name: string | null;
  brand_name: string | null;
  country_id: string | null;
  website: string | null;
  phone: string | null;
  fax: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display (brand-service selects countries(id,code,name))
  country?: { id: string; code: string | null; name: string } | null;
}

export const brandInput = z.object({
  brand_short_name: z.string().optional().nullable(),
  brand_name: z.string().min(1, "Brand name is required"),
  country_id: z.string().uuid().optional().nullable(),
  website: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type BrandInput = z.infer<typeof brandInput>;
