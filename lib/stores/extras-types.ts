import { z } from "zod";

// ============================================================================
// Opening Stock (0200)
// ============================================================================
export const OPENING_STOCK_STATUSES = ["draft", "posted", "cancelled"] as const;
export type OpeningStockStatus = (typeof OPENING_STOCK_STATUSES)[number];
export const OPENING_STOCK_STATUS_LABELS: Record<OpeningStockStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
};
export interface OpeningStock {
  id: string;
  code: string | null;
  store_id: string;
  opening_date: string | null;
  status: OpeningStockStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface OpeningStockLine {
  id: string;
  opening_stock_id: string;
  item_id: string;
  quantity: number;
  note: string | null;
  sort_order: number;
}
export const openingStockInput = z.object({
  store_id: z.string().uuid(),
  opening_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type OpeningStockInput = z.infer<typeof openingStockInput>;
export const openingStockLineInput = z.object({
  item_id: z.string().uuid(),
  quantity: z.coerce.number().nonnegative().default(0),
  note: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().optional(),
});
export type OpeningStockLineInput = z.input<typeof openingStockLineInput>;

// ============================================================================
// Material Requisition Slip (0201)
// ============================================================================
export const MRS_STATUSES = ["draft", "submitted", "approved", "issued", "rejected", "cancelled"] as const;
export type MrsStatus = (typeof MRS_STATUSES)[number];
export const MRS_STATUS_LABELS: Record<MrsStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  issued: "Issued",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export interface MaterialRequisition {
  id: string;
  code: string | null;
  store_id: string;
  department: string;
  required_date: string | null;
  status: MrsStatus;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface MaterialRequisitionLine {
  id: string;
  material_requisition_id: string;
  item_id: string;
  requested_qty: number;
  issued_qty: number;
  sort_order: number;
}
export const mrsInput = z.object({
  store_id: z.string().uuid(),
  department: z.string().min(1),
  required_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type MrsInput = z.infer<typeof mrsInput>;
export const mrsLineInput = z.object({
  item_id: z.string().uuid(),
  requested_qty: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().optional(),
});
export type MrsLineInput = z.input<typeof mrsLineInput>;

// ============================================================================
// Return to Vendor (0202)
// ============================================================================
export const VENDOR_RETURN_STATUSES = ["draft", "returned", "replaced", "closed", "cancelled"] as const;
export type VendorReturnStatus = (typeof VENDOR_RETURN_STATUSES)[number];
export const VENDOR_RETURN_STATUS_LABELS: Record<VendorReturnStatus, string> = {
  draft: "Draft",
  returned: "Returned",
  replaced: "Replaced",
  closed: "Closed",
  cancelled: "Cancelled",
};
export interface VendorReturn {
  id: string;
  code: string | null;
  store_id: string;
  vendor_id: string | null;
  reason: string | null;
  return_date: string | null;
  status: VendorReturnStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface VendorReturnLine {
  id: string;
  vendor_return_id: string;
  item_id: string;
  return_qty: number;
  replacement_qty: number;
  sort_order: number;
}
export const vendorReturnInput = z.object({
  store_id: z.string().uuid(),
  vendor_id: z.string().uuid().optional().nullable(),
  reason: z.string().optional().nullable(),
  return_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type VendorReturnInput = z.infer<typeof vendorReturnInput>;
export const vendorReturnLineInput = z.object({
  item_id: z.string().uuid(),
  return_qty: z.coerce.number().nonnegative().default(0),
  replacement_qty: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().optional(),
});
export type VendorReturnLineInput = z.input<typeof vendorReturnLineInput>;

// ============================================================================
// CSP Receipt (0203)
// ============================================================================
export const CSP_STATUSES = ["draft", "posted", "cancelled"] as const;
export type CspStatus = (typeof CSP_STATUSES)[number];
export const CSP_STATUS_LABELS: Record<CspStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
};
export interface CspReceipt {
  id: string;
  code: string | null;
  store_id: string;
  buyer_id: string | null;
  receipt_date: string | null;
  reference: string | null;
  status: CspStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface CspReceiptLine {
  id: string;
  csp_receipt_id: string;
  item_id: string;
  quantity: number;
  note: string | null;
  sort_order: number;
}
export const cspInput = z.object({
  store_id: z.string().uuid(),
  buyer_id: z.string().uuid().optional().nullable(),
  receipt_date: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type CspInput = z.infer<typeof cspInput>;
export const cspLineInput = z.object({
  item_id: z.string().uuid(),
  quantity: z.coerce.number().nonnegative().default(0),
  note: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().optional(),
});
export type CspLineInput = z.input<typeof cspLineInput>;
