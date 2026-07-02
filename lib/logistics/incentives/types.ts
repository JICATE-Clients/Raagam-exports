import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const INCENTIVE_SCHEMES = ["rodtep", "drawback", "rosctl", "other"] as const;
export type IncentiveScheme = (typeof INCENTIVE_SCHEMES)[number];

export const SCHEME_LABELS: Record<IncentiveScheme, string> = {
  rodtep: "RoDTEP",
  drawback: "Duty Drawback",
  rosctl: "RoSCTL",
  other: "Other",
};

export const INCENTIVE_STATUSES = ["draft", "filed", "received", "rejected"] as const;
export type IncentiveStatus = (typeof INCENTIVE_STATUSES)[number];

export const INCENTIVE_STATUS_LABELS: Record<IncentiveStatus, string> = {
  draft: "Draft",
  filed: "Filed",
  received: "Received",
  rejected: "Rejected",
};

export function incentiveStatusTone(status: IncentiveStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "filed":
      return "info";
    case "received":
      return "success";
    case "rejected":
      return "danger";
  }
}

export interface ExportIncentiveFile {
  id: string;
  code: string | null;
  scheme: IncentiveScheme;
  shipping_bill_no: string | null;
  invoice_ref: string | null;
  currency_code: string | null;
  fob_value: number;
  incentive_rate: number;
  incentive_amount: number;
  filing_date: string | null;
  reference_no: string | null;
  status: IncentiveStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const incentiveInput = z.object({
  scheme: z.enum(INCENTIVE_SCHEMES).default("rodtep"),
  shipping_bill_no: z.string().optional().nullable(),
  invoice_ref: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  fob_value: z.coerce.number().nonnegative().default(0),
  incentive_rate: z.coerce.number().nonnegative().default(0),
  incentive_amount: z.coerce.number().nonnegative().default(0),
  filing_date: z.string().optional().nullable(),
  reference_no: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type IncentiveInput = z.infer<typeof incentiveInput>;
