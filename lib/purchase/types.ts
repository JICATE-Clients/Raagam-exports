import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ---------- enums ----------
export const VENDOR_TYPES = [
  "yarn",
  "knitting",
  "dyeing",
  "trims",
  "packing",
  "processing",
  "general",
] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export const RFQ_STATUSES = ["open", "closed", "awarded"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const PO_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  partially_received: "Partially Received",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const GRN_STATUSES = ["draft", "posted"] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

export const QC_STATUSES = ["pending", "passed", "failed", "partial"] as const;
export type QcStatus = (typeof QC_STATUSES)[number];

export const DC_STATUSES = ["issued", "partially_returned", "closed"] as const;
export type DcStatus = (typeof DC_STATUSES)[number];

export const PO_TYPES = ["local", "import"] as const;
export type PoType = (typeof PO_TYPES)[number];

export const FREIGHT_TYPES = ["itemwise", "consolidated"] as const;
export type FreightType = (typeof FREIGHT_TYPES)[number];

export const CHARGE_TYPES = ["add", "less"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

// ---------- interfaces ----------
export interface Vendor {
  id: string;
  code: string | null;
  name: string;
  vendor_type: VendorType | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Rfq {
  id: string;
  code: string | null;
  title: string;
  budget_id: string | null;
  status: RfqStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RfqLine {
  id: string;
  rfq_id: string;
  item_id: string | null;
  description: string;
  quantity: number;
  uom_id: string | null;
  sort_order: number;
}

export interface RfqQuote {
  id: string;
  rfq_id: string;
  vendor_id: string;
  total_amount: number;
  currency_code: string | null;
  lead_days: number | null;
  is_selected: boolean;
  notes: string | null;
  created_at: string;
}

export interface RfqQuoteLine {
  id: string;
  rfq_quote_id: string;
  rfq_line_id: string;
  unit_price: number;
  amount: number;
  lead_days: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrder {
  id: string;
  code: string | null;
  vendor_id: string;
  budget_id: string | null;
  rfq_id: string | null;
  purchase_indent_id: string | null;
  location_id: string | null;
  currency_code: string | null;
  status: PoStatus;
  order_date: string | null;
  expected_date: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  // --- enriched fields (0350) ---
  po_type: PoType;
  exchange_rate: number | null;
  foreign_currency_code: string | null;
  foreign_total_amount: number;
  // commercial
  payment_terms: string | null;
  ship_mode: string | null;
  ship_type: string | null;
  pay_mode: string | null;
  place_of_delivery: string | null;
  invoice_send_to: string | null;
  vat_against: string | null;
  duty_against: string | null;
  // freight
  freight_type: FreightType | null;
  freight_inr: number;
  freight_fgn: number;
  // insurance
  insurance_inr: number;
  insurance_fgn: number;
  // value summary INR
  basic_inr: number;
  discount_inr: number;
  duty_inr: number;
  vat_inr: number;
  cess_inr: number;
  gross_inr: number;
  net_inr: number;
  round_off_inr: number;
  // value summary FGN
  basic_fgn: number;
  discount_fgn: number;
  duty_fgn: number;
  vat_fgn: number;
  cess_fgn: number;
  gross_fgn: number;
  net_fgn: number;
  round_off_fgn: number;
  // agent
  agent_id: string | null;
  agent_commission_rate: number;
  agent_commission_amount: number;
  // general / logistics
  quality_requirements: string | null;
  bank_guarantee: string | null;
  warranty_terms: string | null;
  delivery_instructions: string | null;
  insurance_details: string | null;
  port_of_shipment: string | null;
  transport_name: string | null;
  transport_details: string | null;
  reference: string | null;
}

export interface PoLineItem {
  id: string;
  purchase_order_id: string;
  item_id: string | null;
  description: string;
  quantity: number;
  uom_id: string | null;
  unit_price: number;
  amount: number;
  received_qty: number;
  sort_order: number;
  // --- enriched fields (0350) ---
  item_group_id: string | null;
  item_class: string | null;
  category: string | null;
  is_size_wise: boolean;
  is_colorwise: boolean;
  has_multiple_deliveries: boolean;
  quote_no: string | null;
  quote_reference: string | null;
  billing_uom_id: string | null;
  weight_per_uom: number | null;
  rolls: number;
  meters: number;
  weight: number;
  net_rate: number;
  is_foc: boolean;
  delivery_date: string | null;
}

// ---------- Band 0: Item Groups ----------
export interface PoItemGroup {
  id: string;
  purchase_order_id: string;
  sl_no: number;
  ppm_no: string | null;
  garment_ppm_id: string | null;
  group_no: string | null;
  group_description: string | null;
  customer_name: string | null;
  style_no: string | null;
  style_description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------- Band 2: Size Deliveries ----------
export interface PoSizeDelivery {
  id: string;
  po_line_item_id: string;
  delivery_date: string | null;
  rolls: number;
  quantity: number;
  meters: number;
  weight: number;
  rate: number;
  net_rate: number;
  po_value: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------- Band 3: Delivery Sizes ----------
export interface PoDeliverySize {
  id: string;
  po_size_delivery_id: string;
  bom_size: string | null;
  item_size: string | null;
  rolls: number;
  quantity: number;
  weight: number;
  rate: number;
  net_rate: number;
  po_value: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------- Band 4: Item Size Deliveries (alternate) ----------
export interface PoItemSizeDelivery {
  id: string;
  po_line_item_id: string;
  bom_size: string | null;
  item_size: string | null;
  stitch_length: number | null;
  loop_length: number | null;
  rolls: number;
  quantity: number;
  weight: number;
  rate: number;
  net_rate: number;
  po_value: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------- Additional Charges ----------
export interface PoAdditionalCharge {
  id: string;
  purchase_order_id: string;
  charge_type: ChargeType;
  label: string;
  rate_type: string | null;
  rate: number;
  inr_amount: number;
  fgn_amount: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Grn {
  id: string;
  code: string | null;
  vendor_id: string | null;
  location_id: string | null;
  grn_date: string | null;
  status: GrnStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrnLineItem {
  id: string;
  grn_id: string;
  po_line_item_id: string | null;
  purchase_order_id: string | null;
  description: string;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  qc_status: QcStatus;
  rejection_reason: string | null;
  sort_order: number;
}

export interface DeliveryChallan {
  id: string;
  code: string | null;
  vendor_id: string | null;
  location_id: string | null;
  dc_date: string | null;
  purpose: string | null;
  status: DcStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DcLineItem {
  id: string;
  delivery_challan_id: string;
  item_id: string | null;
  description: string;
  sent_qty: number;
  returned_qty: number;
  uom_id: string | null;
  sort_order: number;
}

// ---------- input schemas ----------
export const vendorInput = z.object({
  name: capsName(),
  vendor_type: z.enum(VENDOR_TYPES).optional().nullable(),
  contact_person: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gst_number: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type VendorInput = z.infer<typeof vendorInput>;

export const rfqLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type RfqLineInput = z.infer<typeof rfqLineInput>;

export const rfqInput = z.object({
  title: z.string().min(1),
  budget_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(rfqLineInput).default([]),
});
export type RfqInput = z.infer<typeof rfqInput>;

export const rfqQuoteInput = z.object({
  rfq_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  total_amount: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().optional().nullable(),
  lead_days: z.coerce.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type RfqQuoteInput = z.infer<typeof rfqQuoteInput>;

export const rfqQuoteLineInput = z.object({
  rfq_quote_id: z.string().uuid(),
  rfq_line_id: z.string().uuid(),
  unit_price: z.coerce.number().nonnegative().default(0),
  amount: z.coerce.number().nonnegative().default(0),
  lead_days: z.coerce.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type RfqQuoteLineInput = z.infer<typeof rfqQuoteLineInput>;

export const poLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  /**
   * Which garment order this line buys for (0424).
   *
   * NULL is general stock, and such a line is not quantity-checked against any
   * Material BOM. On the LINE rather than the header because one PO legitimately
   * covers two orders — and because there was no other route: 0373's
   * `purchase_orders.purchase_indent_id` was never applied to this database.
   */
  sales_order_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  unit_price: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
  // enriched fields (all optional — DB column defaults handle missing values)
  item_group_id: z.string().uuid().optional().nullable(),
  item_class: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  is_size_wise: z.boolean().optional(),
  is_colorwise: z.boolean().optional(),
  has_multiple_deliveries: z.boolean().optional(),
  quote_no: z.string().optional().nullable(),
  quote_reference: z.string().optional().nullable(),
  billing_uom_id: z.string().uuid().optional().nullable(),
  weight_per_uom: z.coerce.number().optional().nullable(),
  rolls: z.coerce.number().int().optional(),
  meters: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  net_rate: z.coerce.number().nonnegative().optional(),
  is_foc: z.boolean().optional(),
  delivery_date: z.string().optional().nullable(),
});
export type PoLineInput = z.infer<typeof poLineInput>;

export const poItemGroupInput = z.object({
  purchase_order_id: z.string().uuid(),
  sl_no: z.coerce.number().int().default(0),
  ppm_no: z.string().optional().nullable(),
  group_no: z.string().optional().nullable(),
  group_description: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  style_no: z.string().optional().nullable(),
  style_description: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type PoItemGroupInput = z.infer<typeof poItemGroupInput>;

export const poSizeDeliveryInput = z.object({
  po_line_item_id: z.string().uuid(),
  delivery_date: z.string().optional().nullable(),
  rolls: z.coerce.number().int().optional(),
  quantity: z.coerce.number().nonnegative().optional(),
  meters: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  net_rate: z.coerce.number().nonnegative().optional(),
  po_value: z.coerce.number().nonnegative().optional(),
  sort_order: z.coerce.number().int().optional(),
});
export type PoSizeDeliveryInput = z.infer<typeof poSizeDeliveryInput>;

export const poDeliverySizeInput = z.object({
  po_size_delivery_id: z.string().uuid(),
  bom_size: z.string().optional().nullable(),
  item_size: z.string().optional().nullable(),
  rolls: z.coerce.number().int().optional(),
  quantity: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  net_rate: z.coerce.number().nonnegative().optional(),
  po_value: z.coerce.number().nonnegative().optional(),
  sort_order: z.coerce.number().int().optional(),
});
export type PoDeliverySizeInput = z.infer<typeof poDeliverySizeInput>;

export const poItemSizeDeliveryInput = z.object({
  po_line_item_id: z.string().uuid(),
  bom_size: z.string().optional().nullable(),
  item_size: z.string().optional().nullable(),
  stitch_length: z.coerce.number().optional().nullable(),
  loop_length: z.coerce.number().optional().nullable(),
  rolls: z.coerce.number().int().optional(),
  quantity: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  net_rate: z.coerce.number().nonnegative().optional(),
  po_value: z.coerce.number().nonnegative().optional(),
  sort_order: z.coerce.number().int().optional(),
});
export type PoItemSizeDeliveryInput = z.infer<typeof poItemSizeDeliveryInput>;

export const poAdditionalChargeInput = z.object({
  purchase_order_id: z.string().uuid(),
  charge_type: z.enum(CHARGE_TYPES),
  label: z.string().min(1),
  rate_type: z.string().optional().nullable(),
  rate: z.coerce.number().nonnegative().default(0),
  inr_amount: z.coerce.number().default(0),
  fgn_amount: z.coerce.number().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type PoAdditionalChargeInput = z.infer<typeof poAdditionalChargeInput>;

export const purchaseOrderInput = z.object({
  vendor_id: z.string().uuid(),
  budget_id: z.string().uuid().optional().nullable(),
  rfq_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  order_date: z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(poLineInput).default([]),
  // enriched fields (all optional — DB column defaults handle missing values)
  po_type: z.enum(PO_TYPES).optional(),
  exchange_rate: z.coerce.number().optional().nullable(),
  foreign_currency_code: z.string().optional().nullable(),
  payment_terms: z.string().optional().nullable(),
  ship_mode: z.string().optional().nullable(),
  ship_type: z.string().optional().nullable(),
  pay_mode: z.string().optional().nullable(),
  place_of_delivery: z.string().optional().nullable(),
  invoice_send_to: z.string().optional().nullable(),
  vat_against: z.string().optional().nullable(),
  duty_against: z.string().optional().nullable(),
  freight_type: z.enum(FREIGHT_TYPES).optional().nullable(),
  agent_id: z.string().uuid().optional().nullable(),
  agent_commission_rate: z.coerce.number().nonnegative().optional(),
  reference: z.string().optional().nullable(),
  // general / logistics
  quality_requirements: z.string().optional().nullable(),
  bank_guarantee: z.string().optional().nullable(),
  warranty_terms: z.string().optional().nullable(),
  delivery_instructions: z.string().optional().nullable(),
  insurance_details: z.string().optional().nullable(),
  port_of_shipment: z.string().optional().nullable(),
  transport_name: z.string().optional().nullable(),
  transport_details: z.string().optional().nullable(),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

export const grnLineInput = z.object({
  po_line_item_id: z.string().uuid().optional().nullable(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  received_qty: z.coerce.number().nonnegative().default(0),
  accepted_qty: z.coerce.number().nonnegative().default(0),
  rejected_qty: z.coerce.number().nonnegative().default(0),
  qc_status: z.enum(QC_STATUSES).default("pending"),
  rejection_reason: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type GrnLineInput = z.infer<typeof grnLineInput>;

export const grnInput = z.object({
  vendor_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  grn_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(grnLineInput).default([]),
});
export type GrnInput = z.infer<typeof grnInput>;

export const dcLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  sent_qty: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type DcLineInput = z.infer<typeof dcLineInput>;

export const dcInput = z.object({
  vendor_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  dc_date: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(dcLineInput).default([]),
});
export type DcInput = z.infer<typeof dcInput>;

// ---------- computations ----------
export function lineAmount(quantity: number, unitPrice: number): number {
  return quantity * unitPrice;
}

/** Open (un-received) balance for a PO line. */
export function poLineOpenBalance(
  line: Pick<PoLineItem, "quantity" | "received_qty">,
): number {
  return Math.max(0, line.quantity - line.received_qty);
}

/**
 * Auto-derive a PO's receipt status from its lines (only moves among the
 * receiving states; preserves draft/pending/cancelled/closed which are manual).
 */
export function derivePoReceiptStatus(
  current: PoStatus,
  lines: Pick<PoLineItem, "quantity" | "received_qty">[],
): PoStatus {
  if (["draft", "pending_approval", "cancelled", "closed"].includes(current)) {
    return current;
  }
  if (lines.length === 0) return current;
  const allReceived = lines.every((l) => l.received_qty >= l.quantity);
  const anyReceived = lines.some((l) => l.received_qty > 0);
  if (allReceived) return "received";
  if (anyReceived) return "partially_received";
  return "approved";
}

/** Outstanding qty to return for a DC line. */
export function dcLineBalance(
  line: Pick<DcLineItem, "sent_qty" | "returned_qty">,
): number {
  return Math.max(0, line.sent_qty - line.returned_qty);
}

/** Calculate net rate after discount/additions. */
export function calcNetRate(
  rate: number,
  discountPct: number = 0,
  addCharges: number = 0,
  lessCharges: number = 0,
): number {
  return rate * (1 - discountPct / 100) + addCharges - lessCharges;
}

/** Convert amount at exchange rate. */
export function calcForeignAmount(inrAmount: number, exchangeRate: number): number {
  if (!exchangeRate || exchangeRate === 0) return 0;
  return inrAmount / exchangeRate;
}

/** Sum charges by type. */
export function sumCharges(
  charges: Pick<PoAdditionalCharge, "charge_type" | "inr_amount" | "fgn_amount">[],
  type: ChargeType,
): { inr: number; fgn: number } {
  return charges
    .filter((c) => c.charge_type === type)
    .reduce(
      (acc, c) => ({
        inr: acc.inr + (c.inr_amount || 0),
        fgn: acc.fgn + (c.fgn_amount || 0),
      }),
      { inr: 0, fgn: 0 },
    );
}
