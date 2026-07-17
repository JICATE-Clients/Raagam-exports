import { z } from "zod";

// ============================================================================
// Shade Groups — parent-child master (shade_groups + shades).
// Each Shade Group collects a set of shade/colour variants used in dyeing
// and finishing processes. hours_reqd captures standard processing time.
// ============================================================================

export interface ShadeRow {
  id: string;
  shade_id: string | null;
  short_name: string | null;
  shade_name: string | null;
}

export interface ShadeGroup {
  id: string;
  short_name: string | null;
  name: string;
  hours_reqd: number | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  shades?: ShadeRow[];
}

export const shadeGroupInput = z.object({
  short_name: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  hours_reqd: z.number().nullable().optional(),
  inactive: z.boolean().default(false),
});
export type ShadeGroupInput = z.infer<typeof shadeGroupInput>;
