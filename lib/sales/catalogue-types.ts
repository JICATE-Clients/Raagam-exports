import { z } from "zod";

export interface StyleCatalogue {
  id: string;
  code: string | null;
  cr_no: string | null;
  cr_date: string | null;
  style_category: string | null;
  size_group_id: string | null;
  catalogue_description: string | null;
  basic_price: number | null;
  pcs_per_box: number | null;
  hsn_code: string | null;
  catalogue_for: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface StylePriceList {
  id: string;
  code: string | null;
  pricelist_date: string | null;
  reference: string | null;
  effective_from: string | null;
  style_type: string | null;
  rate_for: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface PiEnquiry {
  id: string;
  code: string | null;
  enquiry_date: string;
  enquiry_against: string | null;
  sample_type: string | null;
  order_type: string | null;
  action_type: string | null;
  customer_id: string | null;
  country_code: string | null;
  customer_department: string | null;
  season: string | null;
  season_yr: string | null;
  customer_reference: string | null;
  agent_name: string | null;
  received_date: string | null;
  receipt_mode: string | null;
  delivery_to: string | null;
  delivery_mode: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const catalogueInput = z.object({
  cr_no: z.string().optional().nullable(),
  cr_date: z.string().optional().nullable(),
  style_category: z.string().optional().nullable(),
  size_group_id: z.string().uuid().optional().nullable(),
  catalogue_description: z.string().optional().nullable(),
  basic_price: z.coerce.number().optional().nullable(),
  pcs_per_box: z.coerce.number().int().optional().nullable(),
  hsn_code: z.string().optional().nullable(),
  catalogue_for: z.string().optional().nullable(),
});
export type CatalogueInput = z.infer<typeof catalogueInput>;

export const priceListInput = z.object({
  pricelist_date: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  effective_from: z.string().optional().nullable(),
  style_type: z.string().optional().nullable(),
  rate_for: z.enum(["bulk", "sample"]).optional().nullable(),
});
export type PriceListInput = z.infer<typeof priceListInput>;

export const piEnquiryInput = z.object({
  enquiry_date: z.string(),
  enquiry_against: z.string().optional().nullable(),
  sample_type: z.string().optional().nullable(),
  order_type: z.enum(["new", "repeat"]).optional().nullable(),
  action_type: z.string().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  country_code: z.string().optional().nullable(),
  customer_department: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  season_yr: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
  agent_name: z.string().optional().nullable(),
  received_date: z.string().optional().nullable(),
  receipt_mode: z.string().optional().nullable(),
  delivery_to: z.string().optional().nullable(),
  delivery_mode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PiEnquiryInput = z.infer<typeof piEnquiryInput>;
