import { z } from "zod";

// ---------------------------------------------------------------------------
// Indent Approval
// ---------------------------------------------------------------------------

export const APPROVAL_TYPES = ["purchase", "store", "department"] as const;
export const INDENT_APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

export interface IndentApproval {
  id: string;
  indent_id: string;
  approval_type: (typeof APPROVAL_TYPES)[number];
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndentApprovalItem {
  id: string;
  indent_approval_id: string;
  sno: number;
  category_name: string | null;
  item_description: string | null;
  uom_id: string | null;
  qty: number;
  last_po_rate: number | null;
  stock_qty: number | null;
  is_approved: boolean | null;
  remarks: string | null;
}

export const indentApprovalInput = z.object({
  indent_id: z.string().uuid(),
  approval_type: z.enum(APPROVAL_TYPES),
  remarks: z.string().optional().nullable(),
  items: z.array(z.object({
    category_name: z.string().optional().nullable(),
    item_description: z.string().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    qty: z.coerce.number().default(0),
    last_po_rate: z.coerce.number().optional().nullable(),
    stock_qty: z.coerce.number().optional().nullable(),
    is_approved: z.boolean().optional().nullable(),
    remarks: z.string().optional().nullable(),
  })).default([]),
});
export type IndentApprovalInput = z.infer<typeof indentApprovalInput>;

// ---------------------------------------------------------------------------
// Indent to Purchase Conversion
// ---------------------------------------------------------------------------

export const CONVERSION_STATUSES = ["pending", "converted", "cancelled"] as const;

export interface IndentConversion {
  id: string;
  code: string | null;
  indent_id: string;
  conversion_date: string;
  purchase_order_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndentConversionItem {
  id: string;
  conversion_id: string;
  sno: number;
  item_class_name: string | null;
  category_name: string | null;
  item_description: string | null;
  uom_id: string | null;
  qty: number;
  wt: number | null;
  rate: number;
  po_value: number;
  vendor_name: string | null;
  supply_type: string | null;
  required_date: string | null;
  is_sizewise: boolean;
  is_approval_required: boolean;
}

export const indentConversionInput = z.object({
  indent_id: z.string().uuid(),
  conversion_date: z.string(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_class_name: z.string().optional().nullable(),
    category_name: z.string().optional().nullable(),
    item_description: z.string().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    qty: z.coerce.number().default(0),
    rate: z.coerce.number().default(0),
    vendor_name: z.string().optional().nullable(),
    supply_type: z.string().optional().nullable(),
    required_date: z.string().optional().nullable(),
  })).default([]),
});
export type IndentConversionInput = z.infer<typeof indentConversionInput>;
