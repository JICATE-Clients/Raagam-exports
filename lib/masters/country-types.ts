import { z } from "zod";
import { nullableFormat, ISD_RE } from "@/lib/validation/formats";

// ============================================================================
// Countries — Associates master (0232). Legacy EDP2 "Country" form with a
// Country Group enum and Save / Save-As-Drafts (is_draft) support.
// ============================================================================
export const COUNTRY_GROUPS = ["EU", "USA", "CANADA", "OTHERS"] as const;
export type CountryGroup = (typeof COUNTRY_GROUPS)[number];

export interface Country {
  id: string;
  code: string | null;
  name: string;
  country_group: CountryGroup | null;
  ecgc_code: string | null;
  isd_code: string | null;
  default_country: boolean;
  inactive: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

export const countryInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  country_group: z.enum(COUNTRY_GROUPS).nullable().default(null),
  ecgc_code: z.string().optional().nullable(),
  isd_code: nullableFormat(ISD_RE, "Enter a valid ISD code (e.g. +91)"),
  default_country: z.boolean().default(false),
  inactive: z.boolean().default(false),
  is_draft: z.boolean().default(false),
});
export type CountryInput = z.infer<typeof countryInput>;
