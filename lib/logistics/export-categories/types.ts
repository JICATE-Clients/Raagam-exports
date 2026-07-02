import { z } from "zod";

export interface ExportCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderCategoryAssignment {
  id: string;
  sales_order_id: string;
  category_id: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export const categoryInput = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional().nullable(),
  is_active: z.coerce.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const assignmentInput = z.object({
  sales_order_id: z.string().uuid("Select an order"),
  category_id: z.string().uuid("Select a category"),
  notes: z.string().optional().nullable(),
});
export type AssignmentInput = z.infer<typeof assignmentInput>;
