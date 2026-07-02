import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const PROCESS_TYPES = [
  "knitting",
  "dyeing",
  "printing",
  "washing",
  "finishing",
  "embroidery",
  "other",
] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const PRFQ_STATUSES = ["open", "confirmed", "cancelled"] as const;
export type PrfqStatus = (typeof PRFQ_STATUSES)[number];

export const PRFQ_STATUS_LABELS: Record<PrfqStatus, string> = {
  open: "Open",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export function prfqStatusTone(status: PrfqStatus): StatusTone {
  switch (status) {
    case "open":
      return "info";
    case "confirmed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface ProcessRfq {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  process_type: ProcessType;
  description: string | null;
  quantity: number;
  uom: string | null;
  budget_rate: number;
  confirmed_vendor_id: string | null;
  confirmed_rate: number | null;
  over_budget_approved: boolean;
  status: PrfqStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessRfqQuote {
  id: string;
  rfq_id: string;
  vendor_id: string;
  rate: number;
  delivery_days: number | null;
  remarks: string | null;
  created_at: string;
}

export const processRfqInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  process_type: z.enum(PROCESS_TYPES),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  uom: z.string().optional().nullable(),
  budget_rate: z.coerce.number().nonnegative().default(0),
  remarks: z.string().optional().nullable(),
});
export type ProcessRfqInput = z.infer<typeof processRfqInput>;

export const processQuoteInput = z.object({
  vendor_id: z.string().uuid("Select a vendor"),
  rate: z.coerce.number().nonnegative().default(0),
  delivery_days: z.coerce.number().int().nonnegative().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ProcessQuoteInput = z.infer<typeof processQuoteInput>;
