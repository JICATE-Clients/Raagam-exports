import { z } from "zod";

export interface FabricOrder {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  order_date: string;
  customer_id: string | null;
  status: string;
  location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DomesticProductionPlan {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  plan_date: string;
  customer_id: string | null;
  status: string;
  location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const fabricOrderInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  order_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  styles: z.array(z.object({
    style_ref_no: z.string().optional().nullable(),
    article_no: z.string().optional().nullable(),
    delivery_date: z.string().optional().nullable(),
  })).default([]),
});
export type FabricOrderInput = z.infer<typeof fabricOrderInput>;

export const domesticProdPlanInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  plan_date: z.string(),
  customer_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  styles: z.array(z.object({
    style_ref_no: z.string().optional().nullable(),
    style_no: z.string().optional().nullable(),
    style_description: z.string().optional().nullable(),
    uom_id: z.string().optional().nullable(),
    order_qty: z.coerce.number().default(0),
    no_of_box: z.coerce.number().int().default(0),
  })).default([]),
});
export type DomesticProdPlanInput = z.infer<typeof domesticProdPlanInput>;
