import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const CHEQUE_DIRECTIONS = ["outgoing", "incoming"] as const;
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number];

export const CHEQUE_DIRECTION_LABELS: Record<ChequeDirection, string> = {
  outgoing: "Outgoing (paid)",
  incoming: "Incoming (received)",
};

export const CHEQUE_STATUSES = [
  "issued",
  "deposited",
  "cleared",
  "cancelled",
  "bounced",
] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  issued: "Issued",
  deposited: "Deposited",
  cleared: "Cleared",
  cancelled: "Cancelled",
  bounced: "Bounced",
};

export function chequeStatusTone(status: ChequeStatus): StatusTone {
  switch (status) {
    case "issued":
      return "neutral";
    case "deposited":
      return "info";
    case "cleared":
      return "success";
    case "cancelled":
      return "warning";
    case "bounced":
      return "danger";
  }
}

export interface Cheque {
  id: string;
  code: string | null;
  cheque_number: string | null;
  bank_name: string | null;
  party_name: string | null;
  direction: ChequeDirection;
  currency_code: string | null;
  amount: number;
  cheque_date: string | null;
  cleared_date: string | null;
  status: ChequeStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const chequeInput = z.object({
  cheque_number: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  party_name: z.string().optional().nullable(),
  direction: z.enum(CHEQUE_DIRECTIONS).default("outgoing"),
  currency_code: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
  cheque_date: z.string().optional().nullable(),
  cleared_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type ChequeInput = z.infer<typeof chequeInput>;
