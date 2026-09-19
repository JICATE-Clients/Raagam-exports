import { z } from "zod";
import { nullableFormat, nullableKind, MOBILE_IN_RE } from "@/lib/validation/formats";

/* A BLANK BOX IS NULL, NOT "" (2026-09-19: saving the profile failed with
   `invalid input syntax for type date: ""`). The screen seeds every field with
   "" so its inputs stay controlled, and a `date` or `numeric` column refuses
   an empty string. The numbers get the same guard for a quieter reason:
   `z.coerce.number()` turns "" into 0 and saves it silently. The screen sends
   null for a blank number today; this keeps any other caller from storing 0. */
const blankToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

/** An optional `date` column: blank -> null, else strict YYYY-MM-DD (a native
 *  date box accepts a six-digit year and reports itself valid). */
const optDate = z.preprocess(
  blankToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date").nullable().optional(),
);

/** An optional `numeric` column: blank -> null, never 0. */
const optNumber = z.preprocess(blankToNull, z.coerce.number().nullable().optional());

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
  aepc_date: optDate,
  rex_no: z.string().optional().nullable(),
  lut_no: z.string().optional().nullable(),
  lut_date: optDate,
  textile_committee_no: z.string().optional().nullable(),
  textile_committee_date: optDate,
  renewed_on: optDate,
  valid_upto: optDate,
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
  insurance_policy_date: optDate,
  export_insurance_pct: optNumber,

  min_wages: optNumber,
  bonus_from_date: optDate,

  footer_text: z.string().optional().nullable(),
  with_logo: z.boolean().optional(),
  /* THE LOGO'S PUBLIC URL (2026-09-19) — uploaded to the `company-assets`
     bucket (0589) by the Company Profile screen, printed on every document
     letterhead (`letterheadLogoOf`, lib/orders/fabric-bom/letterhead.ts). The
     column existed since 0318; nothing could fill it until now. */
  logo: z.string().optional().nullable(),
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
