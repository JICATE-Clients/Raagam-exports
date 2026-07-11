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

// Legacy "Type" and "For" dropdowns (For options provisional — confirm).
export const IWO_TYPES = ["Order Related", "Non-Order Related"] as const;
export const IWO_FOR_OPTIONS = ["Garments", "Fabric", "Yarn", "Made-ups"] as const;

export interface InternalWorkOrder {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  location_id: string | null;
  title: string | null;
  instructions: string | null;
  status: IwoStatus;
  issued_at: string | null;
  // legacy header fields (0125)
  iwo_type: string | null;
  iwo_for: string | null;
  iwo_date: string;
  item_class_id: string | null;
  owner_of_trial_id: string | null;
  customer_id: string | null;
  reference: string | null;
  style_id: string | null;
  deli_date: string | null;
  remarks: string | null;
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

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const iwoInput = z.object({
  // legacy trial/work-order header (sales order optional — may be Non-Order Related)
  sales_order_id: uuidN,
  location_id: uuidN,
  title: nullableText,
  instructions: nullableText,
  iwo_type: nullableText,
  iwo_for: nullableText,
  iwo_date: z.string().min(1, "Date is required"),
  item_class_id: uuidN,
  owner_of_trial_id: uuidN,
  customer_id: uuidN,
  reference: nullableText,
  style_id: uuidN,
  deli_date: nullableText,
  remarks: nullableText,
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
