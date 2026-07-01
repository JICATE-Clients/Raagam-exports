import { z } from "zod";

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

export interface PurchaseOrder {
  id: string;
  code: string | null;
  vendor_id: string;
  budget_id: string | null;
  rfq_id: string | null;
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
  name: z.string().min(1),
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

export const poLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  unit_price: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type PoLineInput = z.infer<typeof poLineInput>;

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
