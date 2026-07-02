import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const PROCESS_MODES = ["in_house", "outsourced"] as const;
export type ProcessMode = (typeof PROCESS_MODES)[number];

export const PROCESS_MODE_LABELS: Record<ProcessMode, string> = {
  in_house: "In-house",
  outsourced: "Outsourced",
};

export function processModeTone(mode: ProcessMode): StatusTone {
  return mode === "in_house" ? "info" : "warning";
}

/** Common garment processes — used as a datalist to speed entry. */
export const COMMON_PROCESSES = [
  "Cutting",
  "Printing",
  "Embroidery",
  "Sewing",
  "Washing",
  "Finishing",
  "Ironing",
  "Packing",
];

export interface OrderGarmentProcess {
  id: string;
  sales_order_id: string;
  sequence: number;
  name: string;
  mode: ProcessMode;
  notes: string | null;
  created_at: string;
}

export const orderProcessInput = z.object({
  sales_order_id: z.string().uuid(),
  name: z.string().min(1, "Process name required"),
  mode: z.enum(PROCESS_MODES).default("in_house"),
  sequence: z.coerce.number().int().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
export type OrderProcessInput = z.infer<typeof orderProcessInput>;
