import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const PACK_METHODS = ["solid", "assorted", "ratio"] as const;
export type PackMethod = (typeof PACK_METHODS)[number];

export const PACK_METHOD_LABELS: Record<PackMethod, string> = {
  solid: "Solid (one colour/size per carton)",
  assorted: "Assorted",
  ratio: "Ratio pack",
};

export const PLA_STATUSES = ["draft", "finalised", "cancelled"] as const;
export type PlaStatus = (typeof PLA_STATUSES)[number];

export const PLA_STATUS_LABELS: Record<PlaStatus, string> = {
  draft: "Draft",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

export function plaStatusTone(status: PlaStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "finalised":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface PackingAdvice {
  id: string;
  code: string | null;
  sales_order_id: string;
  pack_method: PackMethod;
  remarks: string | null;
  status: PlaStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackingAdviceLine {
  id: string;
  advice_id: string;
  description: string;
  pcs_per_carton: number;
  carton_count: number;
  net_weight: number | null;
  gross_weight: number | null;
  sort_order: number;
  created_at: string;
}

/** Total pieces for a line = pcs/carton × cartons. */
export function lineTotalPcs(
  line: Pick<PackingAdviceLine, "pcs_per_carton" | "carton_count">,
): number {
  return (line.pcs_per_carton || 0) * (line.carton_count || 0);
}

export const packingAdviceInput = z.object({
  sales_order_id: z.string().uuid("Select an order"),
  pack_method: z.enum(PACK_METHODS).default("assorted"),
  remarks: z.string().optional().nullable(),
});
export type PackingAdviceInput = z.infer<typeof packingAdviceInput>;

export const packingLineInput = z.object({
  description: z.string().min(1, "Description required"),
  pcs_per_carton: z.coerce.number().nonnegative().default(0),
  carton_count: z.coerce.number().nonnegative().default(0),
  net_weight: z.coerce.number().nonnegative().optional().nullable(),
  gross_weight: z.coerce.number().nonnegative().optional().nullable(),
  sort_order: z.coerce.number().int().nonnegative().default(0),
});
export type PackingLineInput = z.infer<typeof packingLineInput>;
