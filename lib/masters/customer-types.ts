import { z } from "zod";

// ============================================================================
// Customers — master-detail (0240). Legacy EDP2 "Customer" form: a header
// (Short Name · Blocked · Name · Doc Prefix · ID · Also Consignee · Country) +
// an Applicant(s) sub-list (5 picker slots) + five tabs (Address | Agents |
// Customer Supplied Items | Customer Nominated Vendors | CustomerGeneral).
//
// Phase 1 models the header + the Applicant slots + the Address tab + the
// Address Contact child grid. The other four tabs are deferred.
//
// Picker fields are FKs: country/address country → countries; city/state and
// the grid's department/designation/internal_department → config_lookups; each
// applicant slot → applicants.
// ============================================================================

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
  // embedded for display
  applicant?: { id: string; code: string | null; name: string } | null;
}

export interface Customer {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  blocked: boolean;
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
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  contacts: CustomerContact[];
  applicants: CustomerApplicant[];
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
  email_id: nullableText,
  internal_department_id: uuidN,
});

export const customerApplicantInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  applicant_id: uuidN,
});

export const customerInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
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
  email: nullableText,
  web_site: nullableText,
  is_draft: z.boolean().default(false),
  contacts: z.array(customerContactInput).default([]),
  applicants: z.array(customerApplicantInput).default([]),
});
export type CustomerInput = z.infer<typeof customerInput>;
