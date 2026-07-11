import { z } from "zod";

export interface TaCompletion {
  id: string;
  code: string | null;
  order_id: string | null;
  customer_id: string | null;
  order_no: string | null;
  completion_date: string;
  completion_year: number | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export const taCompletionInput = z.object({
  order_id: z.string().uuid("Select the SC No"),
  customer_id: z.string().uuid().nullable().default(null),
  order_no: z.string().optional().nullable(),
  completion_date: z.string().min(1, "Date is required"),
  remarks: z.string().optional().nullable(),
});
export type TaCompletionInput = z.infer<typeof taCompletionInput>;
