import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const PROFORMA_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "cancelled",
] as const;
export type ProformaStatus = (typeof PROFORMA_STATUSES)[number];

export const PROFORMA_STATUS_LABELS: Record<ProformaStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  cancelled: "Cancelled",
};

export function proformaStatusTone(status: ProformaStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "sent":
      return "info";
    case "accepted":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface ProformaInvoice {
  id: string;
  code: string | null;
  buyer_id: string;
  currency_code: string | null;
  incoterm: string | null;
  issue_date: string | null;
  valid_until: string | null;
  status: ProformaStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProformaLine {
  id: string;
  proforma_id: string;
  description: string;
  hsn_code: string | null;
  quantity: number;
  unit_price: number;
  sort_order: number;
  created_at: string;
}

export function lineAmount(
  line: Pick<ProformaLine, "quantity" | "unit_price">,
): number {
  return (line.quantity || 0) * (line.unit_price || 0);
}

export const proformaInput = z.object({
  buyer_id: z.string().uuid("Select a buyer"),
  currency_code: z.string().optional().nullable(),
  incoterm: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ProformaInput = z.infer<typeof proformaInput>;

export const proformaLineInput = z.object({
  description: z.string().min(1, "Description required"),
  hsn_code: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  unit_price: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().nonnegative().default(0),
});
export type ProformaLineInput = z.infer<typeof proformaLineInput>;
