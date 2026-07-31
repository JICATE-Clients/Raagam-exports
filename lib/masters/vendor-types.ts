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
  PHONE_INTL_RE,
} from "@/lib/validation/formats";

const PHONE_MSG = "Enter a valid phone number (7–15 digits, optional +country code)";

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
  mobile: string | null;
  /** NULL = same as `mobile` — resolve via effectiveWhatsApp(), never read directly. */
  whatsapp: string | null;
  email_id: string | null;
}

/**
 * One row of the legacy Vendor ▸ Item Category grid — the commercial terms this
 * vendor supplies ONE item class / category under. Only reachable while the
 * vendor is a Bought Items Vendor (see DUTY_DETAILS below).
 */
export interface VendorItemCategory {
  id: string;
  vendor_id: string;
  sno: number;
  item_class_id: string | null;
  /** Scoped BY item_class_id — see the cascade note on the screen. */
  category_id: string | null;
  /** A `levies` row of type VAT / CST. */
  vat_levy_id: string | null;
  /** A `levies` row of type DUTY / EXCISE DUTY. */
  duty_levy_id: string | null;
  lead_days: number | null;
  form_id: string | null;
  supply_type_id: string | null;
  payment_term_id: string | null;
}

/** The vendor-level radio above the Item Category grid; legacy offers four. */
export const DUTY_DETAILS = ["None", "CT3", "Annexure", "RG23"] as const;
export type DutyDetail = (typeof DUTY_DETAILS)[number];

/**
 * One row of the legacy Vendor ▸ Process grid — a process this vendor is paid to
 * do, with the VAT that applies and the share of the charge it applies to. Shown
 * only while the vendor Is Processor.
 */
export interface VendorProcess {
  id: string;
  vendor_id: string;
  sno: number;
  /** The real Process master (0227), not the `process` config_lookups kind. */
  process_id: string | null;
  /** A `levies` row of type VAT / CST — legacy calls the column "Vat Description". */
  vat_levy_id: string | null;
  vat_portion_pct: number;
  payment_term_id: string | null;
}

/** One row of Vendor ▸ Service — shown while the vendor Is Service Provider. */
export interface VendorService {
  id: string;
  vendor_id: string;
  sno: number;
  service_type_id: string | null;
  payment_term_id: string | null;
}

/**
 * One row of Vendor ▸ SubContractor — shown while the vendor Is Sub Contractor.
 * The Process grid minus VAT: legacy asks only which process, on what terms.
 */
export interface VendorSubcontract {
  id: string;
  vendor_id: string;
  sno: number;
  process_id: string | null;
  payment_term_id: string | null;
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
  /** Item Category tab — the radio above the grid. Never null (defaults 'None'). */
  duty_details: DutyDetail;
  // The TDS / ESI panel, shared by the Process, Service and SubContractor tabs:
  // ONE set of vendor-level values, not three.
  tds_levy_id: string | null;
  esi_no: string | null;
  esi_retention_pct: number;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  country?: { id: string; code: string | null; name: string } | null;
  addresses: VendorAddress[];
  item_categories: VendorItemCategory[];
  processes: VendorProcess[];
  services: VendorService[];
  subcontracts: VendorSubcontract[];
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
  mobile: nullableFormat(PHONE_INTL_RE, PHONE_MSG),
  whatsapp: nullableFormat(PHONE_INTL_RE, PHONE_MSG),
  email_id: nullableFormat(EMAIL_RE, "Enter a valid email address"),
});

export const vendorItemCategoryInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  item_class_id: uuidN,
  category_id: uuidN,
  vat_levy_id: uuidN,
  duty_levy_id: uuidN,
  // Blank stays blank: an unfilled lead time is "not agreed yet", not zero days.
  lead_days: z.coerce.number().int().nonnegative().nullable().default(null),
  form_id: uuidN,
  supply_type_id: uuidN,
  payment_term_id: uuidN,
});

export const vendorProcessInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  process_id: uuidN,
  vat_levy_id: uuidN,
  // A share of a charge, so 0-100 and never null — the legacy box shows 0.00.
  vat_portion_pct: z.coerce.number().min(0).max(100).default(0),
  payment_term_id: uuidN,
});

export const vendorServiceInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  service_type_id: uuidN,
  payment_term_id: uuidN,
});

export const vendorSubcontractInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  process_id: uuidN,
  payment_term_id: uuidN,
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
    gst_no: nullableFormat(GSTIN_RE, "Invalid GSTIN (e.g. 33ABCDE1234F1Z7)"),
    debit_group_id: uuidN,
    credit_group_id: uuidN,
    enterprise_status: nullableText,
    memorandum_no: nullableText,
    inhouse_unit_id: nullableText,
    duty_against: nullableText,
    duty_details: z.enum(DUTY_DETAILS).default("None"),
    // Shared TDS / ESI panel. `esi_no` is deliberately unvalidated text for the
    // same reason TIN No is: it is whatever the ESIC office issued, and a format
    // guess would strand rows on their next edit.
    tds_levy_id: uuidN,
    esi_no: nullableText,
    esi_retention_pct: z.coerce.number().min(0).max(100).default(0),
    is_draft: z.boolean().default(false),
    addresses: z.array(vendorAddressInput).default([]),
    // All four grids are sent even when their tab is hidden: the screen hides a
    // section when its category box is un-ticked, it does not discard rows.
    // Un-ticking by mistake must not silently delete agreed terms.
    item_categories: z.array(vendorItemCategoryInput).default([]),
    processes: z.array(vendorProcessInput).default([]),
    services: z.array(vendorServiceInput).default([]),
    subcontracts: z.array(vendorSubcontractInput).default([]),
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
