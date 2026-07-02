import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const PRA_STATUSES = ["pending", "approved", "rejected"] as const;
export type PraStatus = (typeof PRA_STATUSES)[number];

export const PRA_STATUS_LABELS: Record<PraStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function praStatusTone(status: PraStatus): StatusTone {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

export interface ProcessRateAmendment {
  id: string;
  code: string | null;
  process_rfq_id: string;
  old_rate: number | null;
  new_rate: number;
  reason: string | null;
  status: PraStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decided_reason: string | null;
  created_at: string;
}

export const rateAmendmentInput = z.object({
  process_rfq_id: z.string().uuid("Select a confirmed process order"),
  new_rate: z.coerce.number().nonnegative().default(0),
  reason: z.string().optional().nullable(),
});
export type RateAmendmentInput = z.infer<typeof rateAmendmentInput>;
