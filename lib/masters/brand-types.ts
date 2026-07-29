import { z } from "zod";
import { nullableFormat, PHONE_INTL_RE } from "@/lib/validation/formats";

const PHONE_MSG = "Enter a valid phone number (7–15 digits, optional +country code)";

// ============================================================================
// Brands — Materials master (0278). Legacy EDP2 "Brand" form:
// Short Name · Name (req) · Country (opt → countries FK via ⓘ picker) ·
// Website · Phone · Mobile · WhatsApp · Blocked.
// ============================================================================
export interface Brand {
  id: string;
  brand_short_name: string | null;
  brand_name: string | null;
  country_id: string | null;
  website: string | null;
  phone: string | null;
  mobile: string | null;
  /** NULL = same as `mobile` — resolve via effectiveWhatsApp(), never read directly. */
  whatsapp: string | null;
  inactive: boolean;
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
  mobile: nullableFormat(PHONE_INTL_RE, PHONE_MSG),
  whatsapp: nullableFormat(PHONE_INTL_RE, PHONE_MSG),
  inactive: z.boolean().default(false),
});
export type BrandInput = z.infer<typeof brandInput>;
