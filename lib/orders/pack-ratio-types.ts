import { z } from "zod";

export interface OrderPackRatio {
  id: string;
  sales_order_id: string;
  style_ref_no: string | null;
  style_no: string | null;
  assort_no: string | null;
  assortment_type: string | null;
  delivery_date: string | null;
  no_of_cartons: number;
  pcs_per_inner: number;
  inner_per_master: number;
  pcs_per_master: number;
  pcs_per_pack: number;
  master_carton_name: string | null;
  inner_carton_name: string | null;
  pack_description: string | null;
  is_ratio_wise_pack: boolean;
  ratio_for: string | null;
  is_single_style_pack: boolean;
  country_code: string | null;
  total_qty: number;
  order_qty: number;
  created_at: string;
  updated_at: string;
}

export interface OrderPackRatioLine {
  id: string;
  pack_ratio_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  design: string | null;
  combo: string | null;
  no_of_cartons: number;
  pcs_per_pack: number;
  order_qty: number;
  size1_qty: number; size2_qty: number; size3_qty: number; size4_qty: number;
  size5_qty: number; size6_qty: number; size7_qty: number; size8_qty: number;
  size9_qty: number; size10_qty: number; size11_qty: number; size12_qty: number;
  size13_qty: number; size14_qty: number; size15_qty: number; size16_qty: number;
}

export interface ExcessOrder {
  id: string;
  code: string | null;
  sales_order_id: string;
  req_no: string | null;
  ppm_no: string | null;
  customer_name: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExcessOrderItem {
  id: string;
  excess_order_id: string;
  sno: number;
  item_class_name: string | null;
  description: string | null;
  uom_id: string | null;
  qty: number;
}

export const packRatioInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  style_no: z.string().optional().nullable(),
  assortment_type: z.string().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  no_of_cartons: z.coerce.number().int().default(0),
  pcs_per_inner: z.coerce.number().int().default(0),
  inner_per_master: z.coerce.number().int().default(0),
  pcs_per_pack: z.coerce.number().int().default(0),
  master_carton_name: z.string().optional().nullable(),
  inner_carton_name: z.string().optional().nullable(),
  pack_description: z.string().optional().nullable(),
  is_ratio_wise_pack: z.boolean().default(false),
  ratio_for: z.enum(["master", "inner"]).optional().nullable(),
  is_single_style_pack: z.boolean().default(false),
  country_code: z.string().optional().nullable(),
});
export type PackRatioInput = z.infer<typeof packRatioInput>;

export const excessOrderInput = z.object({
  sales_order_id: z.string().uuid(),
  req_no: z.string().optional().nullable(),
  ppm_no: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_class_name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    qty: z.coerce.number().default(0),
  })).default([]),
});
export type ExcessOrderInput = z.infer<typeof excessOrderInput>;
