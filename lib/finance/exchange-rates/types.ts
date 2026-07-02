import { z } from "zod";

export interface ExchangeRateDetail {
  id: string;
  currency_code: string | null;
  reference: string | null;
  foreign_amount: number;
  booked_rate: number;
  actual_rate: number;
  rate_date: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Forex gain (+) / loss (−) = foreign amount × (actual − booked). */
export function gainLoss(
  r: Pick<ExchangeRateDetail, "foreign_amount" | "booked_rate" | "actual_rate">,
): number {
  return (r.foreign_amount || 0) * ((r.actual_rate || 0) - (r.booked_rate || 0));
}

export const exchangeRateInput = z.object({
  currency_code: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  foreign_amount: z.coerce.number().nonnegative().default(0),
  booked_rate: z.coerce.number().nonnegative().default(0),
  actual_rate: z.coerce.number().nonnegative().default(0),
  rate_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ExchangeRateInput = z.infer<typeof exchangeRateInput>;
