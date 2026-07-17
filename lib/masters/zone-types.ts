import { z } from "zod";

// ============================================================================
// Zones — parent-child master (zones + zone_areas).
// Each Zone groups geographic areas for associate/employee assignment,
// route planning, and regional reporting.
// ============================================================================

export interface ZoneAreaRow {
  id: string;
  area_name: string | null;
}

export interface Zone {
  id: string;
  zone_short_name: string | null;
  zone_name: string;
  blocked: boolean;
  created_at: string;
  updated_at: string;
  areas?: ZoneAreaRow[];
}

export const zoneInput = z.object({
  zone_short_name: z.string().optional().nullable(),
  zone_name: z.string().min(1, "Zone name is required"),
  blocked: z.boolean().default(false),
});
export type ZoneInput = z.infer<typeof zoneInput>;
