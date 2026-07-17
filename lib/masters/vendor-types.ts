import { z } from "zod";
import {
  nullableFormat,
  GSTIN_RE,
  PAN_RE,
  IFSC_RE,
  BANK_ACCT_RE,
  WEBSITE_RE,
  EMAIL_RE,
  PINCODE_IN_RE,
} from "@/lib/validation/formats";

// ============================================================================
// Vendors — master-detail (0246). Legacy EDP2 "Vendor" form: a header (Short
// Name · Inactive · Type · Category flags · Name · Country · Group Name · Status)
// + a registration footer (TIN · Reg.Caption · Reg.No/Dt · PAN · Web site) +
// two tabs (Address | Other Details). Phase 1 = header + footer + Address grid;
// the "Other Details" tab is deferred.
// ============================================================================
export const VENDOR_TYPES = ["With in State", "Other State", "Foreign Vendor"] as const;
export const VENDOR_STATUSES = ["Approved", "Under Evaluation", "Terminated", "Hold"] as const;
export const GST_REG_STATUSES = ["Registered", "Unregistered", "Composite"] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export type GstRegStatus = (typeof GST_REG_STATUSES)[number];

export interface VendorAddress {
  id: string;
  vendor_id: string;
  sno: number;
  address_type: string | null;
  street: string | null;
  city_id: string | null;
  state_id: string | null;
  country_id: string | null;
  pin: string | null;
  land_line: string | null;
  fax: string | null;
  email_id: string | null;
}

export interface Vendor {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  inactive: boolean;
  vendor_type: VendorType | null;
  country_id: string | null;
  group_id: string | null;
  status: VendorStatus;
  is_bought_items_vendor: boolean;
  is_processor: boolean;
  is_service_provider: boolean;
  is_sub_contractor: boolean;
  tin_no: string | null;
  reg_caption: string | null;
  reg_no_dt: string | null;
  pan_no: string | null;
  web_site: string | null;
  // Other Details tab
  bank_name: string | null;
  branch: string | null;
  ac_no: string | null;
  ifsc_code: string | null;
  ac_type: string | null;
  gst_reg_status: GstRegStatus | null;
  gst_no: string | null;
  debit_group_id: string | null;
  credit_group_id: string | null;
  enterprise_status: string | null;
  memorandum_no: string | null;
  inhouse_unit_id: string | null;
  duty_against: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  addresses: VendorAddress[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const vendorAddressInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  address_type: nullableText,
  street: nullableText,
  city_id: uuidN,
  state_id: uuidN,
  country_id: uuidN,
  pin: nullableText, // IN-format enforced conditionally in vendorInput.superRefine
  land_line: nullableText,
  fax: nullableText,
  email_id: nullableFormat(EMAIL_RE, "Enter a valid email address"),
});

export const vendorInput = z
  .object({
    code: nullableText,
    name: z.string().min(1, "Name is required"),
    inactive: z.boolean().default(false),
    vendor_type: z.enum(VENDOR_TYPES).nullable().default(null),
    country_id: uuidN,
    group_id: uuidN,
    status: z.enum(VENDOR_STATUSES).default("Approved"),
    is_bought_items_vendor: z.boolean().default(false),
    is_processor: z.boolean().default(false),
    is_service_provider: z.boolean().default(false),
    is_sub_contractor: z.boolean().default(false),
    tin_no: nullableText,
    reg_caption: nullableText,
    reg_no_dt: nullableText,
    pan_no: nullableFormat(PAN_RE, "Invalid PAN (e.g. ABCDE1234F)"),
    web_site: nullableFormat(WEBSITE_RE, "Enter a valid website URL"),
    bank_name: nullableText,
    branch: nullableText,
    ac_no: nullableFormat(BANK_ACCT_RE, "Account number must be 9–18 digits"),
    ifsc_code: nullableFormat(IFSC_RE, "Invalid IFSC (e.g. HDFC0001234)"),
    ac_type: nullableText,
    gst_reg_status: z.enum(GST_REG_STATUSES).nullable().default(null),
    gst_no: nullableFormat(GSTIN_RE, "Invalid GSTIN (e.g. 33ABCDE1234F1Z5)"),
    debit_group_id: uuidN,
    credit_group_id: uuidN,
    enterprise_status: nullableText,
    memorandum_no: nullableText,
    inhouse_unit_id: nullableText,
    duty_against: nullableText,
    is_draft: z.boolean().default(false),
    addresses: z.array(vendorAddressInput).default([]),
  })
  // PIN codes use the Indian 6-digit format for domestic vendors only; a
  // Foreign Vendor's address PIN is accepted as-is.
  .superRefine((v, ctx) => {
    if (v.vendor_type === "Foreign Vendor") return;
    v.addresses.forEach((a, i) => {
      const pin = (a.pin ?? "").trim();
      if (pin && !PINCODE_IN_RE.test(pin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a 6-digit PIN code",
          path: ["addresses", i, "pin"],
        });
      }
    });
  });
export type VendorInput = z.infer<typeof vendorInput>;
