import { z } from "zod";

export interface OrderBooking {
  id: string;
  code: string | null;
  sales_order_id: string;
  booking_date: string;
  customer_id: string | null;
  order_no: string | null;
  order_type: string | null;
  order_category: string | null;
  order_txn_type: string | null;
  season: string | null;
  season_yr: string | null;
  delivery_date: string | null;
  merchandiser_id: string | null;
  agent_name: string | null;
  receipt_mode: string | null;
  received_date: string | null;
  ship_type_id: string | null;
  ship_mode: string | null;
  pay_mode: string | null;
  country_code: string | null;
  material_composition: string | null;
  bundle_tag_caption: string | null;
  location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  certifications: OrderBookingCertification[];
}

export interface OrderBookingCertification {
  id: string;
  order_booking_id: string;
  sno: number;
  certification: string;
}

export interface DueDateConfirmation {
  id: string;
  code: string | null;
  sales_order_id: string;
  entry_date: string;
  customer_id: string | null;
  delivery_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: DueDateConfirmationItem[];
}

export interface DueDateConfirmationItem {
  id: string;
  confirmation_id: string;
  sno: number;
  line_item_id: string | null;
  item_description: string | null;
  order_qty: number;
  delivery_date: string | null;
}

export interface ContractReview {
  id: string;
  code: string | null;
  sales_order_id: string;
  review_date: string;
  customer_id: string | null;
  order_no: string | null;
  merchandiser_name: string | null;
  currency_code: string | null;
  ioc_value: number;
  order_value: number;
  profit_loss_value: number;
  profit_loss_pct: number;
  approval_status: string;
  is_sent_to_revision: boolean;
  remarks: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  styles: ContractReviewStyle[];
}

export interface ContractReviewStyle {
  id: string;
  contract_review_id: string;
  sno: number;
  style_no: string | null;
  ioc_value: number;
  order_value: number;
  profit_loss_value: number;
  profit_loss_pct: number;
}

// Zod input schemas
export const RECEIPT_MODES = ["email", "phone", "fax", "courier", "direct"] as const;
export const SHIP_MODES = ["air", "sea", "road"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "revision"] as const;

export const orderBookingInput = z.object({
  sales_order_id: z.string().uuid(),
  booking_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  order_no: z.string().optional().nullable(),
  order_type: z.enum(["garment", "home_textile"]).optional().nullable(),
  order_category: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  season_yr: z.string().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  merchandiser_id: z.string().uuid().optional().nullable(),
  agent_name: z.string().optional().nullable(),
  receipt_mode: z.enum(RECEIPT_MODES).optional().nullable(),
  received_date: z.string().optional().nullable(),
  ship_mode: z.enum(SHIP_MODES).optional().nullable(),
  pay_mode: z.string().optional().nullable(),
  country_code: z.string().optional().nullable(),
  material_composition: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  certifications: z.array(z.object({ certification: z.string().min(1) })).default([]),
});
export type OrderBookingInput = z.infer<typeof orderBookingInput>;

export const dueDateConfirmationInput = z.object({
  sales_order_id: z.string().uuid(),
  entry_date: z.string(),
  delivery_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    line_item_id: z.string().uuid().optional().nullable(),
    item_description: z.string().optional().nullable(),
    order_qty: z.coerce.number().default(0),
    delivery_date: z.string().optional().nullable(),
  })).default([]),
});
export type DueDateConfirmationInput = z.infer<typeof dueDateConfirmationInput>;

export const contractReviewInput = z.object({
  sales_order_id: z.string().uuid(),
  review_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  order_no: z.string().optional().nullable(),
  merchandiser_name: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  ioc_value: z.coerce.number().default(0),
  order_value: z.coerce.number().default(0),
  remarks: z.string().optional().nullable(),
  styles: z.array(z.object({
    style_no: z.string().optional().nullable(),
    ioc_value: z.coerce.number().default(0),
    order_value: z.coerce.number().default(0),
  })).default([]),
});
export type ContractReviewInput = z.infer<typeof contractReviewInput>;
