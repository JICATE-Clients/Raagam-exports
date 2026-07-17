import { z } from "zod";
import { nullableFormat, EMAIL_RE, WEBSITE_RE } from "@/lib/validation/formats";
import { SHIP_MODES, PAY_MODES } from "./applicant-types";

// ============================================================================
// Customers — master-detail (0240 base + 0247 tabs). Legacy EDP2 "Customer"
// form: header (Short Name · Inactive · Name · Doc Prefix · ID · Also Consignee ·
// Country) + Applicant(s) slots + five tabs:
//   Address · Agents · Customer Supplied Items · Customer Nominated Vendors ·
//   CustomerGeneral.
//
// Picker backings (see raagam-masters-picker-wiring):
//   country/address country            → countries
//   city/state/dept/designation/int-dept → config_lookups
//   applicant slots                    → applicants
//   agent type / agent                 → config_lookups ('agent_type' / 'agent')
//   supplied-item category             → config_lookups ('material_category')
//   nominated/recommended vendor       → vendors
//   currency 1/2/3                     → currencies(code)
//   ship type                          → config_lookups ('ship_type')
//   receivable term                    → receivable_terms
//   port of loading/discharge          → ports
//   final destination                  → destinations
//   pref. courier                      → couriers
//   packing-list / commercial-invoice format → config_lookups (new kinds)
// ============================================================================

export { SHIP_MODES, PAY_MODES };

export const BUSINESS_ENTITIES = [
  "Proprietorship",
  "Partnership",
  "Pvt Ltd",
  "Pub Ltd",
  "LLP",
  "Others",
] as const;

export interface CustomerContact {
  id: string;
  customer_id: string;
  sno: number;
  department_id: string | null;
  contact_name: string | null;
  designation_id: string | null;
  land_line: string | null;
  mobile: string | null;
  email_id: string | null;
  internal_department_id: string | null;
}

export interface CustomerApplicant {
  id: string;
  customer_id: string;
  sno: number;
  applicant_id: string | null;
  applicant?: { id: string; code: string | null; name: string } | null;
}

export interface CustomerAgent {
  id: string;
  customer_id: string;
  sno: number;
  agent_type_id: string | null;
  agent_id: string | null;
}

/** section = 'sewing' | 'packing' (two grids on the Supplied Items tab). */
export interface CustomerSuppliedItem {
  id: string;
  customer_id: string;
  section: "sewing" | "packing";
  sno: number;
  category_id: string | null;
}

/** list_kind = 'nominated' | 'recommended' (two grids on the Vendors tab). */
export interface CustomerNominatedVendor {
  id: string;
  customer_id: string;
  list_kind: "nominated" | "recommended";
  sno: number;
  vendor_id: string | null;
}

export interface CustomerMarking {
  id: string;
  customer_id: string;
  sno: number;
  marking: string | null;
}

export interface Customer {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  inactive: boolean;
  doc_prefix: string | null;
  doc_id: string | null; // the "ID" field
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
  // CustomerGeneral tab (scalar)
  currency_1: string | null;
  currency_2: string | null;
  currency_3: string | null;
  ship_mode: string | null;
  ship_type_id: string | null;
  pay_mode: string | null;
  receivable_term_id: string | null;
  port_of_loading_id: string | null;
  port_of_discharge_id: string | null;
  final_destination_id: string | null;
  pref_courier_id: string | null;
  packing_list_format_id: string | null;
  commercial_invoice_format_id: string | null;
  also_notify: boolean;
  business_entity: string | null;
  inhouse_unit_id: string | null;
  color_spec_applicable: boolean;
  tcs_applicable: boolean;
  gst_no: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  contacts: CustomerContact[];
  applicants: CustomerApplicant[];
  agents: CustomerAgent[];
  supplied_items: CustomerSuppliedItem[];
  nominated_vendors: CustomerNominatedVendor[];
  markings: CustomerMarking[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const customerContactInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  department_id: uuidN,
  contact_name: nullableText,
  designation_id: uuidN,
  land_line: nullableText,
  mobile: nullableText,
  email_id: nullableFormat(EMAIL_RE, "Enter a valid email address"),
  internal_department_id: uuidN,
});

export const customerApplicantInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  applicant_id: uuidN,
});

export const customerAgentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  agent_type_id: uuidN,
  agent_id: uuidN,
});

export const customerSuppliedItemInput = z.object({
  section: z.enum(["sewing", "packing"]),
  sno: z.coerce.number().int().nonnegative().default(0),
  category_id: uuidN,
});

export const customerNominatedVendorInput = z.object({
  list_kind: z.enum(["nominated", "recommended"]),
  sno: z.coerce.number().int().nonnegative().default(0),
  vendor_id: uuidN,
});

export const customerMarkingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  marking: nullableText,
});

export const customerInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  inactive: z.boolean().default(false),
  doc_prefix: nullableText,
  doc_id: nullableText,
  also_consignee: z.boolean().default(false),
  country_id: uuidN,
  street: nullableText,
  city_id: uuidN,
  state_id: uuidN,
  pin: nullableText,
  address_country_id: uuidN,
  land_line: nullableText,
  fax: nullableText,
  email: nullableFormat(EMAIL_RE, "Enter a valid email address"),
  web_site: nullableFormat(WEBSITE_RE, "Enter a valid website URL"),
  // General (scalar)
  currency_1: nullableText,
  currency_2: nullableText,
  currency_3: nullableText,
  ship_mode: z.enum(SHIP_MODES).nullable().default(null),
  ship_type_id: uuidN,
  pay_mode: z.enum(PAY_MODES).nullable().default(null),
  receivable_term_id: uuidN,
  port_of_loading_id: uuidN,
  port_of_discharge_id: uuidN,
  final_destination_id: uuidN,
  pref_courier_id: uuidN,
  packing_list_format_id: uuidN,
  commercial_invoice_format_id: uuidN,
  also_notify: z.boolean().default(false),
  business_entity: nullableText,
  inhouse_unit_id: nullableText,
  color_spec_applicable: z.boolean().default(false),
  tcs_applicable: z.boolean().default(false),
  gst_no: nullableText,
  is_draft: z.boolean().default(false),
  // children
  contacts: z.array(customerContactInput).default([]),
  applicants: z.array(customerApplicantInput).default([]),
  agents: z.array(customerAgentInput).default([]),
  supplied_items: z.array(customerSuppliedItemInput).default([]),
  nominated_vendors: z.array(customerNominatedVendorInput).default([]),
  markings: z.array(customerMarkingInput).default([]),
});
export type CustomerInput = z.infer<typeof customerInput>;
