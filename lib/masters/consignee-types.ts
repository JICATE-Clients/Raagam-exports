import { z } from "zod";
export { SHIP_MODES, PAY_MODES, type ShipMode, type PayMode } from "./applicant-types";

// ============================================================================
// Consignees — master-detail (0245 header/Address · 0248 General + Notify tabs).
// Legacy EDP2 "Consignee" form: a header (Short Name · Name · Blocked · Country ⓘ
// · Also Notify [Yes/No] · Customer ⓘ) + three tabs:
//   Address — address fields + Contact child grid
//   General — currency 1/2/3 → currencies · Ship Mode/Pay Mode fixed lists ·
//     Ship Type/Payment Terms → config_lookups · Bank → banks · A/c No. ·
//     Registration (TIN/PAN/GST) · a Marking child grid
//   Notify  — a child grid of Notify-party references (→ notifies)
//
// Structurally = Notify (0239) + also_notify + customer_id + General + Notify.
// Picker FKs: country/address country → countries; customer → customers; city/
// state + grid dept/designation/internal_department → config_lookups; currency
// 1/2/3 → currencies.code; ship_type/payment_term → config_lookups; bank → banks;
// notify refs → notifies.
// ============================================================================

export interface ConsigneeContact {
  id: string;
  consignee_id: string;
  sno: number;
  department_id: string | null;
  contact_name: string | null;
  designation_id: string | null;
  land_line: string | null;
  mobile: string | null;
  email_id: string | null;
  internal_department_id: string | null;
}

export interface ConsigneeMarking {
  id: string;
  consignee_id: string;
  sno: number;
  marking: string | null;
}

export interface ConsigneeNotify {
  id: string;
  consignee_id: string;
  sno: number;
  notify_id: string | null;
  // embedded for display
  notify?: { id: string; code: string | null; name: string; country_id: string | null } | null;
}

export interface Consignee {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  blocked: boolean;
  country_id: string | null;
  also_notify: boolean;
  customer_id: string | null;
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
  // General tab (0248)
  currency_1: string | null;
  currency_2: string | null;
  currency_3: string | null;
  ship_mode: string | null;
  ship_type_id: string | null;
  pay_mode: string | null;
  payment_term_id: string | null;
  bank_id: string | null;
  ac_no: string | null;
  tin_no: string | null;
  tin_no_2: string | null;
  tin_no_3: string | null;
  pan_no: string | null;
  gst_no: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  contacts: ConsigneeContact[];
  markings: ConsigneeMarking[];
  notify_refs: ConsigneeNotify[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const consigneeContactInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  department_id: uuidN,
  contact_name: nullableText,
  designation_id: uuidN,
  land_line: nullableText,
  mobile: nullableText,
  email_id: nullableText,
  internal_department_id: uuidN,
});

export const consigneeMarkingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  marking: nullableText,
});

export const consigneeNotifyInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  notify_id: uuidN,
});

export const consigneeInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
  country_id: uuidN,
  also_notify: z.boolean().default(false),
  customer_id: uuidN,
  street: nullableText,
  city_id: uuidN,
  state_id: uuidN,
  pin: nullableText,
  address_country_id: uuidN,
  land_line: nullableText,
  fax: nullableText,
  email: nullableText,
  web_site: nullableText,
  // General tab
  currency_1: nullableText,
  currency_2: nullableText,
  currency_3: nullableText,
  ship_mode: nullableText,
  ship_type_id: uuidN,
  pay_mode: nullableText,
  payment_term_id: uuidN,
  bank_id: uuidN,
  ac_no: nullableText,
  tin_no: nullableText,
  tin_no_2: nullableText,
  tin_no_3: nullableText,
  pan_no: nullableText,
  gst_no: nullableText,
  is_draft: z.boolean().default(false),
  contacts: z.array(consigneeContactInput).default([]),
  markings: z.array(consigneeMarkingInput).default([]),
  notify_refs: z.array(consigneeNotifyInput).default([]),
});
export type ConsigneeInput = z.infer<typeof consigneeInput>;
