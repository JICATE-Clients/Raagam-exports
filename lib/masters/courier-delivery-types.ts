import { z } from "zod";

// ============================================================================
// Courier Delivery Addresses — master-detail (0252). Legacy EDP2 "Courier
// Delivery Address" form — structurally identical to Notify (0239): a header
// (Short Name · Name · Blocked · Country) + Address fields + a Contact child
// grid. Picker wiring: country/address country → countries; city/state and the
// grid's department/designation/internal_department → config_lookups.
// ============================================================================

export interface CourierDeliveryContact {
  id: string;
  courier_id: string;
  sno: number;
  department_id: string | null;
  contact_name: string | null;
  designation_id: string | null;
  land_line: string | null;
  mobile: string | null;
  email_id: string | null;
  internal_department_id: string | null;
}

export interface CourierDeliveryAddress {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  blocked: boolean;
  country_id: string | null;
  street: string | null;
  city_id: string | null;
  state_id: string | null;
  pin: string | null;
  address_country_id: string | null;
  land_line: string | null;
  fax: string | null;
  email: string | null;
  web_site: string | null;
  created_at: string;
  updated_at: string;
  country?: { id: string; code: string | null; name: string } | null;
  contacts: CourierDeliveryContact[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const courierDeliveryContactInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  department_id: uuidN,
  contact_name: nullableText,
  designation_id: uuidN,
  land_line: nullableText,
  mobile: nullableText,
  email_id: nullableText,
  internal_department_id: uuidN,
});

export const courierDeliveryInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
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
  contacts: z.array(courierDeliveryContactInput).default([]),
});
export type CourierDeliveryInput = z.infer<typeof courierDeliveryInput>;
