import { z } from "zod";

export const GAN_STATUSES = ["pending", "in_progress", "completed"] as const;
export type GanStatus = (typeof GAN_STATUSES)[number];

export const GAN_RESULTS = ["pass", "fail", "conditional"] as const;
export type GanResult = (typeof GAN_RESULTS)[number];

export interface GanQualityCheck {
  id: string;
  code: string | null;
  grn_id: string;
  grn_line_id: string | null;
  item_id: string | null;
  status: GanStatus;
  overall_result: GanResult | null;
  checked_by: string | null;
  checked_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GanQualityParameter {
  id: string;
  check_id: string;
  parameter_name: string;
  method: string | null;
  spec_min: number | null;
  spec_max: number | null;
  actual_value: string | null;
  unit: string | null;
  result: "pass" | "fail" | null;
  size_label: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const ganCheckInput = z.object({
  grn_id: z.string().uuid(),
  grn_line_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type GanCheckInput = z.infer<typeof ganCheckInput>;

export const ganParameterInput = z.object({
  check_id: z.string().uuid(),
  parameter_name: z.string().min(1),
  method: z.string().optional().nullable(),
  spec_min: z.coerce.number().optional().nullable(),
  spec_max: z.coerce.number().optional().nullable(),
  actual_value: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  result: z.enum(["pass", "fail"]).optional().nullable(),
  size_label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type GanParameterInput = z.infer<typeof ganParameterInput>;
