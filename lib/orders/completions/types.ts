import { z } from "zod";

export interface OrderCompletion {
  id: string;
  code: string | null;
  order_id: string;
  customer_id: string | null;
  order_no: string | null;
  completion_date: string;
  completion_year: number | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export const orderCompletionInput = z.object({
  order_id: z.string().uuid("Select the SC No"),
  customer_id: z.string().uuid().nullable().default(null),
  order_no: z.string().optional().nullable(),
  completion_date: z.string().min(1, "Completion date is required"),
  remarks: z.string().optional().nullable(),
});
export type OrderCompletionInput = z.infer<typeof orderCompletionInput>;
