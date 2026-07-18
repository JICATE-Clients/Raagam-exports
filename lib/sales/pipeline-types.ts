import { z } from "zod";

export interface PipelineOrder {
  id: string;
  code: string | null;
  oc_date: string;
  customer_id: string | null;
  order_no: string | null;
  order_date: string | null;
  is_repeat_order: boolean;
  customer_department: string | null;
  season: string | null;
  season_yr: string | null;
  sample_for: string | null;
  receipt_mode: string | null;
  received_date: string | null;
  order_category: string | null;
  previous_oc_ref: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineOrderStyle {
  id: string;
  pipeline_order_id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  category_name: string | null;
  style_description: string | null;
  uom_id: string | null;
  order_qty: number;
}

export interface SeasonalOrder {
  id: string;
  code: string | null;
  oc_date: string;
  customer_id: string | null;
  style_no: string | null;
  season: string | null;
  season_yr: string | null;
  order_no: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export const pipelineOrderInput = z.object({
  oc_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  order_no: z.string().optional().nullable(),
  order_date: z.string().optional().nullable(),
  is_repeat_order: z.boolean().default(false),
  customer_department: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  season_yr: z.string().optional().nullable(),
  sample_for: z.string().optional().nullable(),
  receipt_mode: z.string().optional().nullable(),
  received_date: z.string().optional().nullable(),
  order_category: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PipelineOrderInput = z.infer<typeof pipelineOrderInput>;

export const seasonalOrderInput = z.object({
  oc_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  style_no: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  season_yr: z.string().optional().nullable(),
  order_no: z.string().optional().nullable(),
});
export type SeasonalOrderInput = z.infer<typeof seasonalOrderInput>;
