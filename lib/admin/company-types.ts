import { z } from "zod";

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
  fax: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),

  reg_street1: z.string().optional().nullable(),
  reg_street2: z.string().optional().nullable(),
  reg_street3: z.string().optional().nullable(),
  reg_city: z.string().optional().nullable(),
  reg_pin_code: z.string().optional().nullable(),
  reg_state: z.string().optional().nullable(),

  pan_no: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  cin_no: z.string().optional().nullable(),
  ie_code: z.string().optional().nullable(),
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
