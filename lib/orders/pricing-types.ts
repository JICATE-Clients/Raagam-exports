import { z } from "zod";

export interface OrderPrice {
  id: string;
  sales_order_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  design: string | null;
  price_type: string | null;
  rate_uom: string | null;
  rate: number;
  rate_for_docs: number;
  mrp_rate: number;
  rate_uom_conv: number;
}

export interface PriceConfirmation {
  id: string;
  code: string | null;
  sales_order_id: string;
  amendment_sno: number;
  last_amendment_sno: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PcPurchaseItem {
  id: string;
  price_conf_id: string;
  item_class_type: string;
  sno: number;
  item_name: string | null;
  stage: string | null;
  item_color: string | null;
  vendor_name: string | null;
  specifications: string | null;
  uom_id: string | null;
  reqd_qty: number;
  is_foc: boolean;
  is_import: boolean;
  currency_code: string | null;
  rate: number;
  exchange_rate: number;
  inr_rate: number;
  moq: number | null;
  last_po_rate: number | null;
  net_rate: number;
  net_inr_rate: number;
}

export interface PcProcess {
  id: string;
  price_conf_id: string;
  process_type: string;
  sno: number;
  process_name: string | null;
  uom_id: string | null;
  qty: number;
  rate: number;
  currency_code: string | null;
  exchange_rate: number;
  inr_rate: number;
  vendor_name: string | null;
  is_foc: boolean;
}

export interface PcCmtOperation {
  id: string;
  price_conf_id: string;
  sno: number;
  operation_name: string | null;
  rate: number;
  cost: number;
}

export const ITEM_CLASS_TYPES = ["yarn", "fabric", "accessories"] as const;
export const PROCESS_TYPES = ["yarn", "fabric", "accessories", "garment", "unplanned"] as const;
export const PC_STATUSES = ["draft", "confirmed", "amended", "cancelled"] as const;

export const orderPriceInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  style_no: z.string().optional().nullable(),
  article_no: z.string().optional().nullable(),
  design: z.string().optional().nullable(),
  price_type: z.string().optional().nullable(),
  rate_uom: z.string().optional().nullable(),
  rate: z.coerce.number().default(0),
  rate_for_docs: z.coerce.number().default(0),
  mrp_rate: z.coerce.number().default(0),
});
export type OrderPriceInput = z.infer<typeof orderPriceInput>;

export const priceConfirmationInput = z.object({
  sales_order_id: z.string().uuid(),
  notes: z.string().optional().nullable(),
});
export type PriceConfirmationInput = z.infer<typeof priceConfirmationInput>;

export const pcPurchaseItemInput = z.object({
  price_conf_id: z.string().uuid(),
  item_class_type: z.enum(ITEM_CLASS_TYPES),
  item_name: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  item_color: z.string().optional().nullable(),
  vendor_name: z.string().optional().nullable(),
  uom_id: z.string().optional().nullable(),
  reqd_qty: z.coerce.number().default(0),
  is_foc: z.boolean().default(false),
  is_import: z.boolean().default(false),
  currency_code: z.string().optional().nullable(),
  rate: z.coerce.number().default(0),
  exchange_rate: z.coerce.number().default(1),
});
export type PcPurchaseItemInput = z.infer<typeof pcPurchaseItemInput>;

export const pcProcessInput = z.object({
  price_conf_id: z.string().uuid(),
  process_type: z.enum(PROCESS_TYPES),
  process_name: z.string().optional().nullable(),
  uom_id: z.string().optional().nullable(),
  qty: z.coerce.number().default(0),
  rate: z.coerce.number().default(0),
  currency_code: z.string().optional().nullable(),
  exchange_rate: z.coerce.number().default(1),
  vendor_name: z.string().optional().nullable(),
  is_foc: z.boolean().default(false),
});
export type PcProcessInput = z.infer<typeof pcProcessInput>;
