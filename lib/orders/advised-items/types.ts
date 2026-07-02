import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const ADVISED_STATUSES = ["advised", "sourced", "dropped"] as const;
export type AdvisedStatus = (typeof ADVISED_STATUSES)[number];

export const ADVISED_STATUS_LABELS: Record<AdvisedStatus, string> = {
  advised: "Advised",
  sourced: "Sourced",
  dropped: "Dropped",
};

export function advisedStatusTone(status: AdvisedStatus): StatusTone {
  switch (status) {
    case "advised":
      return "info";
    case "sourced":
      return "success";
    case "dropped":
      return "neutral";
  }
}

export interface OrderAdvisedItem {
  id: string;
  sales_order_id: string;
  description: string;
  attribute: string | null;
  quantity: number;
  unit: string | null;
  supplier: string | null;
  remarks: string | null;
  status: AdvisedStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export const advisedItemInput = z.object({
  sales_order_id: z.string().uuid("Select an order"),
  description: z.string().min(1, "Description required"),
  attribute: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  unit: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type AdvisedItemInput = z.infer<typeof advisedItemInput>;
