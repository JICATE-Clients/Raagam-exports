import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// Seasons — header-only master (`seasons`, 0308). Master Data ▸ System.
//
// Built 2026-10-06 for Sample Entry, whose Season stopped being a fixed list
// (Autumn / Spring / …) and became a link to this master: the client buys in
// QUARTERLY CYCLES, Q1–Q4 (seeded by 0686). Two columns on screen:
//   Season       `season`       the short code, NOT NULL
//   Season Name  `season_name`  what a picker shows; unique (uq_seasons_season_name)
// `season_yr` exists on the table and is not shown — the YEAR is the
// document's own field (Sample Entry's Year), not a property of the season.
// ============================================================================
export interface Season {
  id: string;
  season: string;
  season_name: string | null;
  season_yr: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export const seasonInput = z.object({
  season: capsName("Enter the Season"),
  season_name: capsName("Enter the Season Name"),
  inactive: z.boolean().default(false),
});
export type SeasonInput = z.input<typeof seasonInput>;
