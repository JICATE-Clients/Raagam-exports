import { z } from "zod";

// ============================================================================
// Size Groups — parent-child master (size_groups + size_group_sizes).
// Each Size Group holds an ordered list of named sizes used for garment
// order grids, packing lists, and BOM breakdowns.
// ============================================================================

export interface SizeRow {
  id: string;
  size_name: string;
  sort_order: number | null;
}

export interface SizeGroup {
  id: string;
  size_group_no: string | null;
  size_group_name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  sizes?: SizeRow[];
}

export const sizeGroupInput = z.object({
  size_group_no: z.string().optional().nullable(),
  size_group_name: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type SizeGroupInput = z.infer<typeof sizeGroupInput>;
