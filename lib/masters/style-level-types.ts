import { z } from "zod";

// ============================================================================
// Style Levels — header-only master (Materials submodule).
// Fields: level_short_name (req), level_name, level (1/2/3), inactive.
// ============================================================================
export interface StyleLevel {
  id: string;
  level_short_name: string;
  level_name: string | null;
  level: number | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const styleLevelInput = z.object({
  level_short_name: z.string().min(1, "Level short name is required"),
  level_name: z.string().optional().nullable(),
  level: z.number().int().min(1).max(3).optional().nullable(),
  inactive: z.boolean().default(false),
});
export type StyleLevelInput = z.infer<typeof styleLevelInput>;
