import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const IWO_STATUSES = [
  "draft",
  "issued",
  "completed",
  "cancelled",
] as const;
export type IwoStatus = (typeof IWO_STATUSES)[number];

export const IWO_STATUS_LABELS: Record<IwoStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function iwoStatusTone(status: IwoStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface InternalWorkOrder {
  id: string;
  code: string | null;
  sales_order_id: string;
  location_id: string | null;
  title: string;
  instructions: string | null;
  status: IwoStatus;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IwoLine {
  id: string;
  iwo_id: string;
  description: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export const iwoInput = z.object({
  sales_order_id: z.string().uuid("Select an order"),
  location_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, "Title required"),
  instructions: z.string().optional().nullable(),
});
export type IwoInput = z.infer<typeof iwoInput>;

export const iwoLineInput = z.object({
  description: z.string().min(1, "Description required"),
  quantity: z.coerce.number().nonnegative().default(0),
  unit: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().nonnegative().default(0),
});
export type IwoLineInput = z.infer<typeof iwoLineInput>;
