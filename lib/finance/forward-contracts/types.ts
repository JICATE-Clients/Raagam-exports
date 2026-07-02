import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const FC_STATUSES = [
  "booked",
  "partially_utilised",
  "utilised",
  "cancelled",
  "expired",
] as const;
export type FcStatus = (typeof FC_STATUSES)[number];

export const FC_STATUS_LABELS: Record<FcStatus, string> = {
  booked: "Booked",
  partially_utilised: "Partially utilised",
  utilised: "Utilised",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function fcStatusTone(status: FcStatus): StatusTone {
  switch (status) {
    case "booked":
      return "info";
    case "partially_utilised":
      return "warning";
    case "utilised":
      return "success";
    case "cancelled":
      return "neutral";
    case "expired":
      return "danger";
  }
}

export interface ForwardContract {
  id: string;
  code: string | null;
  contract_number: string | null;
  bank_name: string | null;
  currency_code: string | null;
  amount: number;
  forward_rate: number;
  utilised_amount: number;
  booking_date: string | null;
  maturity_date: string | null;
  status: FcStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Percentage of the cover utilised (0–100, capped). */
export function utilisedPct(
  c: Pick<ForwardContract, "amount" | "utilised_amount">,
): number {
  if (!c.amount) return 0;
  return Math.min(100, Math.round((c.utilised_amount / c.amount) * 100));
}

export const forwardContractInput = z.object({
  contract_number: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
  forward_rate: z.coerce.number().nonnegative().default(0),
  utilised_amount: z.coerce.number().nonnegative().default(0),
  booking_date: z.string().optional().nullable(),
  maturity_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ForwardContractInput = z.infer<typeof forwardContractInput>;
