import { z } from "zod";

export interface OrderCancellation {
  id: string;
  code: string | null;
  order_id: string;
  customer_id: string | null;
  order_no: string | null;
  /** Legacy screen has no Reason field; kept nullable for existing rows. */
  reason: string | null;
  cancelled_date: string;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export const orderCancellationInput = z.object({
  order_id: z.string().uuid("Select the SC No"),
  customer_id: z.string().uuid().nullable().default(null),
  order_no: z.string().optional().nullable(),
  cancelled_date: z.string().min(1, "Cancellation date is required"),
  remarks: z.string().optional().nullable(),
});
export type OrderCancellationInput = z.infer<typeof orderCancellationInput>;
