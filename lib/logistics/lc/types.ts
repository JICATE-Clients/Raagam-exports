import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";

export const LC_STATUSES = [
  "draft",
  "active",
  "amended",
  "expired",
  "closed",
] as const;
export type LcStatus = (typeof LC_STATUSES)[number];

export const LC_STATUS_LABELS: Record<LcStatus, string> = {
  draft: "Draft",
  active: "Active",
  amended: "Amended",
  expired: "Expired",
  closed: "Closed",
};

export function lcStatusTone(status: LcStatus): StatusTone {
  return statusTone(status);
}

export interface LcDetail {
  id: string;
  code: string | null;
  lc_number: string | null;
  buyer_id: string | null;
  bank_name: string | null;
  amount: number;
  currency_code: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  latest_shipment_date: string | null;
  terms: string | null;
  status: LcStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const lcInput = z.object({
  lc_number: z.string().optional().nullable(),
  buyer_id: z.string().uuid().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  latest_shipment_date: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
});
export type LcInput = z.infer<typeof lcInput>;
