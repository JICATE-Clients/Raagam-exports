import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";

export const PRV_STATUSES = ["draft", "finalised", "cancelled"] as const;
export type PrvStatus = (typeof PRV_STATUSES)[number];

export const PRV_STATUS_LABELS: Record<PrvStatus, string> = {
  draft: "Draft",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

export function prvStatusTone(status: PrvStatus): StatusTone {
  return statusTone(status);
}

export interface ProvisionalInvoice {
  id: string;
  code: string | null;
  buyer_id: string | null;
  currency_code: string | null;
  amount: number;
  invoice_date: string | null;
  status: PrvStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const provisionalInvoiceInput = z.object({
  buyer_id: z.string().uuid().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
  invoice_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ProvisionalInvoiceInput = z.infer<typeof provisionalInvoiceInput>;
