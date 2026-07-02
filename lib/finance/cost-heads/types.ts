import { z } from "zod";

export interface CostHead {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CostItem {
  id: string;
  code: string | null;
  name: string;
  cost_head_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const costHeadInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name required"),
  category: z.string().optional().nullable(),
  is_active: z.coerce.boolean().default(true),
});
export type CostHeadInput = z.infer<typeof costHeadInput>;

export const costItemInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name required"),
  cost_head_id: z.string().uuid().optional().nullable(),
  is_active: z.coerce.boolean().default(true),
});
export type CostItemInput = z.infer<typeof costItemInput>;
