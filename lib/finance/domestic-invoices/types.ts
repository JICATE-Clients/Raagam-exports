import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const DGI_STATUSES = ["draft", "issued", "paid", "cancelled"] as const;
export type DgiStatus = (typeof DGI_STATUSES)[number];

export const DGI_STATUS_LABELS: Record<DgiStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  cancelled: "Cancelled",
};

export function dgiStatusTone(status: DgiStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "paid":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface DomesticInvoice {
  id: string;
  code: string | null;
  buyer_id: string | null;
  invoice_date: string | null;
  taxable_amount: number;
  gst_amount: number;
  status: DgiStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function invoiceTotal(
  i: Pick<DomesticInvoice, "taxable_amount" | "gst_amount">,
): number {
  return (i.taxable_amount || 0) + (i.gst_amount || 0);
}

export const domesticInvoiceInput = z.object({
  buyer_id: z.string().uuid().optional().nullable(),
  invoice_date: z.string().optional().nullable(),
  taxable_amount: z.coerce.number().nonnegative().default(0),
  gst_amount: z.coerce.number().nonnegative().default(0),
  remarks: z.string().optional().nullable(),
});
export type DomesticInvoiceInput = z.infer<typeof domesticInvoiceInput>;
