import { z } from "zod";

// ============================================================================
// Seasons — header-only master. Materials submodule.
// Season · Season Year · Season Name · Blocked.
// ============================================================================
export interface Season {
  id: string;
  season: string | null;
  season_yr: string | null;
  season_name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const seasonInput = z.object({
  season: z.string().optional().nullable(),
  season_yr: z.string().optional().nullable(),
  season_name: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type SeasonInput = z.infer<typeof seasonInput>;
