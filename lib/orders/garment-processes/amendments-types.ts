import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const GP_AMENDMENT_TYPES = [
  "add",
  "remove",
  "change",
  "resequence",
] as const;
export type GpAmendmentType = (typeof GP_AMENDMENT_TYPES)[number];

export const GP_AMENDMENT_TYPE_LABELS: Record<GpAmendmentType, string> = {
  add: "Add process",
  remove: "Remove process",
  change: "Change process",
  resequence: "Re-sequence",
};

export const GP_AMENDMENT_STATUSES = ["pending", "approved", "rejected"] as const;
export type GpAmendmentStatus = (typeof GP_AMENDMENT_STATUSES)[number];

export function gpAmendmentStatusTone(status: GpAmendmentStatus): StatusTone {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

export interface GarmentProcessAmendment {
  id: string;
  sales_order_id: string;
  amendment_type: GpAmendmentType;
  description: string | null;
  details: Record<string, unknown>;
  status: GpAmendmentStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decided_reason: string | null;
  created_at: string;
}

export const gpAmendmentInput = z.object({
  sales_order_id: z.string().uuid(),
  amendment_type: z.enum(GP_AMENDMENT_TYPES),
  description: z.string().optional().nullable(),
});
export type GpAmendmentInput = z.infer<typeof gpAmendmentInput>;
