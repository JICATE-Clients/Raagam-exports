import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const KP_STATUSES = ["draft", "running", "completed", "cancelled"] as const;
export type KpStatus = (typeof KP_STATUSES)[number];

export const KP_STATUS_LABELS: Record<KpStatus, string> = {
  draft: "Draft",
  running: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function kpStatusTone(status: KpStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "running":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface KnittingProgram {
  id: string;
  code: string | null;
  sales_order_id: string | null;
  fabric_desc: string | null;
  yarn_desc: string | null;
  gauge: string | null;
  diameter: string | null;
  gsm: number | null;
  planned_qty: number;
  uom: string | null;
  machine: string | null;
  start_date: string | null;
  end_date: string | null;
  status: KpStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const knittingProgramInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  fabric_desc: z.string().optional().nullable(),
  yarn_desc: z.string().optional().nullable(),
  gauge: z.string().optional().nullable(),
  diameter: z.string().optional().nullable(),
  gsm: z.coerce.number().nonnegative().optional().nullable(),
  planned_qty: z.coerce.number().nonnegative().default(0),
  uom: z.string().optional().nullable(),
  machine: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type KnittingProgramInput = z.infer<typeof knittingProgramInput>;
