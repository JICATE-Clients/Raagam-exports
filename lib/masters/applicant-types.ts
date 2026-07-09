import { z } from "zod";

// ============================================================================
// Applicants — master-detail (0238 header/Address · 0241 General). Legacy EDP2
// "Applicant" form: a header (Short Name · Name · Blocked · Also Customer ·
// Also Consignee · Country) + two tabs (Address | General) + a Contact child
// grid.
//
// Picker fields are FKs: country/address country → countries; city/state and
// the grid's department/designation/internal_department → config_lookups.
// General tab (0241): currency_1/2/3 → currencies.code; ship_type_id /
// payment_term_id → config_lookups kinds 'ship_type'/'payment_term';
// bank_id → banks. ship_mode/pay_mode are fixed lists (below).
// ============================================================================

/** Ship Mode — legacy fixed dropdown (no Add). */
export const SHIP_MODES = ["AIR", "ROAD", "SEA", "SEA/AIR"] as const;
export type ShipMode = (typeof SHIP_MODES)[number];

/** Pay Mode — legacy fixed dropdown (no Add). */
export const PAY_MODES = ["CAD", "CASH", "CHEQUE", "DA", "DD", "DP", "LC", "OTH"] as const;
export type PayMode = (typeof PAY_MODES)[number];

export interface ApplicantContact {
  id: string;
  applicant_id: string;
  sno: number;
  department_id: string | null;
  contact_name: string | null;
  designation_id: string | null;
  land_line: string | null;
  mobile: string | null;
  email_id: string | null;
  internal_department_id: string | null;
}

export interface Applicant {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  blocked: boolean;
  also_customer: boolean;
  also_consignee: boolean;
  country_id: string | null;
  // Address tab
  street: string | null;
  city_id: string | null;
  state_id: string | null;
  pin: string | null;
  address_country_id: string | null;
  land_line: string | null;
  fax: string | null;
  email: string | null;
  web_site: string | null;
  // General tab (0241)
  currency_1: string | null; // → currencies.code
  currency_2: string | null;
  currency_3: string | null;
  ship_mode: ShipMode | string | null;
  ship_type_id: string | null; // → config_lookups kind 'ship_type'
  pay_mode: PayMode | string | null;
  payment_term_id: string | null; // → config_lookups kind 'payment_term'
  bank_id: string | null; // → banks.id
  ac_no: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  contacts: ApplicantContact[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const applicantContactInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  department_id: uuidN,
  contact_name: nullableText,
  designation_id: uuidN,
  land_line: nullableText,
  mobile: nullableText,
  email_id: nullableText,
  internal_department_id: uuidN,
});

export const applicantInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
  also_customer: z.boolean().default(false),
  also_consignee: z.boolean().default(false),
  country_id: uuidN,
  street: nullableText,
  city_id: uuidN,
  state_id: uuidN,
  pin: nullableText,
  address_country_id: uuidN,
  land_line: nullableText,
  fax: nullableText,
  email: nullableText,
  web_site: nullableText,
  // General tab (0241)
  currency_1: nullableText,
  currency_2: nullableText,
  currency_3: nullableText,
  ship_mode: nullableText,
  ship_type_id: uuidN,
  pay_mode: nullableText,
  payment_term_id: uuidN,
  bank_id: uuidN,
  ac_no: nullableText,
  is_draft: z.boolean().default(false),
  contacts: z.array(applicantContactInput).default([]),
});
export type ApplicantInput = z.infer<typeof applicantInput>;
