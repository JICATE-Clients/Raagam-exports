import { z } from "zod";

// ============================================================================
// Garment Orders ▸ Garment Order Amendment. Header + 10 sub-tabs.
// 0126 built the header + Logistic (charges + style-price grids) + Reason.
// 0128 added the data tabs — Style(s), Color/Print (dyeings + prints +
// structures), Combos, Prices, Approval Qty, Country/Sizewise — and reworked
// Reason into the "Amendment In" checkbox panel. Pack type(s) + full Quantities
// remain deferred (no screenshot). Icon fields reference sales_orders / buyers /
// profiles / garment_styles / uoms / color_card_colors / countries / currencies /
// customer_contacts / config_lookups (kinds department, ship_type, agent,
// payment_term, structure, roll_form_print).
// ============================================================================

// Fixed dropdowns — legacy option lists (confirm exact values via screenshots).
export const INITIATED_OPTIONS = ["By Customer", "By Us"] as const;
export const AMEND_TYPE_OPTIONS = ["Garment", "Fabric", "Made-ups"] as const;
export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;
// Reused from the Applicant/Customer masters (see doc/masters-open-questions.md).
export const SHIP_MODES = ["AIR", "ROAD", "SEA"] as const;
export const PAY_MODES = ["CAD", "CASH", "CHEQUE", "DA", "DD", "DP", "LC", "OTH"] as const;
export const RECEIPT_MODES = ["By Mail", "By Hand", "Courier", "Email"] as const;
// Color/Print ▸ Dyeing sections (the Yarn / Fabric split).
export const DYE_SECTIONS = ["yarn", "fabric"] as const;

// ---- row interfaces (mirror DB columns) ----
export interface AmendmentCharge {
  id: string;
  amendment_id: string;
  sno: number;
  section: "less" | "add";
  label: string | null;
  calc_mode: string | null;
  amount: number;
  unit: string | null;
}

export interface AmendmentStylePrice {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  price: number;
  csp_type: string | null;
  csp_price: number;
  fob_buyer_price: number;
  fob_selling_price: number;
}

// ---- Phase 2 (0128) child rows, one per data tab ----

/** Style(s) tab — a styles-detail row. */
export interface AmendmentStyle {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style_id: string | null;
  article_no: string | null;
  style_category: string | null;
  style_description: string | null;
  order_unit_id: string | null;
  plan_unit_id: string | null;
  po_qty: number;
  description: string | null;
}

/** Color/Print tab — a Yarn or Fabric dyeing row. */
export interface AmendmentDyeing {
  id: string;
  amendment_id: string;
  sno: number;
  section: "yarn" | "fabric";
  dye_type: string | null;
  color_id: string | null;
}

/** Color/Print tab — a roll-form print row. */
export interface AmendmentPrint {
  id: string;
  amendment_id: string;
  sno: number;
  print_id: string | null;
}

/** Color/Print tab — a structure row. */
export interface AmendmentStructure {
  id: string;
  amendment_id: string;
  sno: number;
  structure_id: string | null;
}

/** Combos tab — a combo row. */
export interface AmendmentCombo {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
}

/** Prices tab — a price-detail row (distinct from Logistic's style_prices). */
export interface AmendmentPriceDetail {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  price_type: string | null;
  unit: string | null;
  price: number;
}

/** Approval Qty tab — a style + approval quantity row. */
export interface AmendmentApprovalQty {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  approval_qty: number;
}

/** Country/Sizewise tab — a style + countrywise flag row. */
export interface AmendmentCountrySize {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  countrywise: boolean;
}

export interface GarmentOrderAmendment {
  id: string;
  code: string | null;
  is_draft: boolean;
  // order header
  sales_order_id: string | null;
  amend_date: string;
  initiated: string | null;
  amend_type: string | null;
  buyer_id: string | null;
  po_no: string | null;
  po_date: string | null;
  merchandiser_id: string | null;
  season: string | null;
  amend_year: number | null;
  delivery_date: string | null;
  excess_pct: number;
  pack: boolean;
  mult_ord: boolean;
  // logistic scalars
  department_id: string | null;
  ship_type_id: string | null;
  contact_id: string | null;
  logi_po_date: string | null;
  agent_id: string | null;
  ship_mode: string | null;
  country_id: string | null;
  currency_code: string | null;
  received_date: string | null;
  received_mode: string | null;
  pay_mode: string | null;
  pay_terms_id: string | null;
  ex_rate: number;
  avg_rate: number;
  gross_value: number;
  // cash discount
  cd1_pct: number;
  cd1_days: number;
  cd2_pct: number;
  cd2_days: number;
  cd3_pct: number;
  cd3_days: number;
  // reason ("Amendment In" panel)
  amend_in_material_bom: boolean;
  amend_in_fabric_bom: boolean;
  amend_in_garment_process_bom: boolean;
  reason_text: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  sales_order?: { id: string; order_number: string | null } | null;
  buyer?: { id: string; code: string | null; name: string } | null;
  charges: AmendmentCharge[];
  style_prices: AmendmentStylePrice[];
  styles: AmendmentStyle[];
  dyeings: AmendmentDyeing[];
  prints: AmendmentPrint[];
  structures: AmendmentStructure[];
  combos: AmendmentCombo[];
  price_details: AmendmentPriceDetail[];
  approval_qtys: AmendmentApprovalQty[];
  country_sizes: AmendmentCountrySize[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const num = z.coerce.number().default(0);
const intN = z.coerce.number().int().default(0);

export const amendmentChargeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  section: z.enum(["less", "add"]).default("less"),
  label: nullableText,
  calc_mode: nullableText,
  amount: num,
  unit: nullableText,
});

export const amendmentStylePriceInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  price: num,
  csp_type: nullableText,
  csp_price: num,
  fob_buyer_price: num,
  fob_selling_price: num,
});

// ---- Phase 2 (0128) nested grid inputs ----

export const amendmentStyleInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style_id: uuidN,
  article_no: nullableText,
  style_category: nullableText,
  style_description: nullableText,
  order_unit_id: uuidN,
  plan_unit_id: uuidN,
  po_qty: num,
  description: nullableText,
});

export const amendmentDyeingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  section: z.enum(["yarn", "fabric"]).default("yarn"),
  dye_type: nullableText,
  color_id: uuidN,
});

export const amendmentPrintInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  print_id: uuidN,
});

export const amendmentStructureInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  structure_id: uuidN,
});

export const amendmentComboInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
});

export const amendmentPriceDetailInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  price_type: nullableText,
  unit: nullableText,
  price: num,
});

export const amendmentApprovalQtyInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  approval_qty: num,
});

export const amendmentCountrySizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  countrywise: z.boolean().default(false),
});

export const amendmentInput = z.object({
  is_draft: z.boolean().default(false),
  // order header
  sales_order_id: uuidN,
  amend_date: z.string().min(1, "Date is required"),
  initiated: nullableText,
  amend_type: nullableText,
  buyer_id: uuidN,
  po_no: nullableText,
  po_date: nullableText,
  merchandiser_id: uuidN,
  season: nullableText,
  amend_year: z.coerce.number().int().nullable().default(null),
  delivery_date: nullableText,
  excess_pct: num,
  pack: z.boolean().default(false),
  mult_ord: z.boolean().default(false),
  // logistic scalars
  department_id: uuidN,
  ship_type_id: uuidN,
  contact_id: uuidN,
  logi_po_date: nullableText,
  agent_id: uuidN,
  ship_mode: nullableText,
  country_id: uuidN,
  currency_code: nullableText,
  received_date: nullableText,
  received_mode: nullableText,
  pay_mode: nullableText,
  pay_terms_id: uuidN,
  ex_rate: num,
  avg_rate: num,
  gross_value: num,
  // cash discount
  cd1_pct: num,
  cd1_days: intN,
  cd2_pct: num,
  cd2_days: intN,
  cd3_pct: num,
  cd3_days: intN,
  // reason ("Amendment In" panel)
  amend_in_material_bom: z.boolean().default(false),
  amend_in_fabric_bom: z.boolean().default(false),
  amend_in_garment_process_bom: z.boolean().default(false),
  reason_text: nullableText,
  // children
  charges: z.array(amendmentChargeInput).default([]),
  style_prices: z.array(amendmentStylePriceInput).default([]),
  styles: z.array(amendmentStyleInput).default([]),
  dyeings: z.array(amendmentDyeingInput).default([]),
  prints: z.array(amendmentPrintInput).default([]),
  structures: z.array(amendmentStructureInput).default([]),
  combos: z.array(amendmentComboInput).default([]),
  price_details: z.array(amendmentPriceDetailInput).default([]),
  approval_qtys: z.array(amendmentApprovalQtyInput).default([]),
  country_sizes: z.array(amendmentCountrySizeInput).default([]),
});
export type AmendmentInput = z.infer<typeof amendmentInput>;

export function amendmentStatusTone(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): "warning" | "success" {
  return a.is_draft ? "warning" : "success";
}
export function amendmentStatusText(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): string {
  return a.is_draft ? "Draft" : "Recorded";
}
