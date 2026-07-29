import { z } from "zod";
import { nullableFormat, nullableKind, MOBILE_IN_RE } from "@/lib/validation/formats";

export const companyProfileInput = z.object({
  company_short_name: z.string().optional().nullable(),
  company_name: z.string().min(1, "Company name is required"),
  document_prefix_id: z.string().optional().nullable(),

  street1: z.string().optional().nullable(),
  street2: z.string().optional().nullable(),
  street3: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  pin_code: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country_code: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // Your own company, so the strict Indian rule applies here (unlike the buyer-
  // facing masters, which are international-tolerant). This number prints on
  // documents, so a typo is worth catching.
  mobile: nullableFormat(MOBILE_IN_RE, "Enter a 10-digit mobile (starting 6–9)"),
  whatsapp: nullableFormat(MOBILE_IN_RE, "Enter a 10-digit mobile (starting 6–9)"),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),

  reg_street1: z.string().optional().nullable(),
  reg_street2: z.string().optional().nullable(),
  reg_street3: z.string().optional().nullable(),
  reg_city: z.string().optional().nullable(),
  reg_pin_code: z.string().optional().nullable(),
  reg_state: z.string().optional().nullable(),

  // The four numbers that print on outbound documents (invoices, shipping bills),
  // so a typo here is a typo on paper. Shape only — the GSTIN check digit is an
  // advisory on the screen, not a block, because this is one wide form and a bad
  // GSTIN must not freeze every other field on it.
  pan_no: nullableKind("pan"),
  gstin: nullableKind("gstin"),
  cin_no: nullableKind("cin"),
  ie_code: nullableKind("iec"),
  rbi_code: z.string().optional().nullable(),
  reg_no: z.string().optional().nullable(),
  cu_licence_no: z.string().optional().nullable(),
  service_tax_no: z.string().optional().nullable(),
  employer_code: z.string().optional().nullable(),
  ad_code: z.string().optional().nullable(),
  ediac_no: z.string().optional().nullable(),

  aepc_no: z.string().optional().nullable(),
  aepc_date: z.string().optional().nullable(),
  rex_no: z.string().optional().nullable(),
  lut_no: z.string().optional().nullable(),
  lut_date: z.string().optional().nullable(),
  textile_committee_no: z.string().optional().nullable(),
  textile_committee_date: z.string().optional().nullable(),
  renewed_on: z.string().optional().nullable(),
  valid_upto: z.string().optional().nullable(),
  gots_no: z.string().optional().nullable(),
  bci_no: z.string().optional().nullable(),
  oekotex_no: z.string().optional().nullable(),

  ce_commissionerate: z.string().optional().nullable(),
  ce_division: z.string().optional().nullable(),
  ce_range: z.string().optional().nullable(),
  ce_range_address1: z.string().optional().nullable(),
  ce_range_address2: z.string().optional().nullable(),

  insurance_company: z.string().optional().nullable(),
  insurance_policy_no: z.string().optional().nullable(),
  insurance_policy_date: z.string().optional().nullable(),
  export_insurance_pct: z.coerce.number().optional().nullable(),

  min_wages: z.coerce.number().optional().nullable(),
  bonus_from_date: z.string().optional().nullable(),

  footer_text: z.string().optional().nullable(),
  with_logo: z.boolean().optional(),
});

export type CompanyProfileInput = z.infer<typeof companyProfileInput>;

export type CompanyProfile = CompanyProfileInput & {
  id: string;
  logo: string | null;
  logo2: string | null;
  logo_with_name: string | null;
  is_ho: boolean;
  location_ids: string | null;
  created_at: string;
  updated_at: string;
};
