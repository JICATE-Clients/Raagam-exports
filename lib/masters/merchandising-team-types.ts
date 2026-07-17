import { z } from "zod";

// ============================================================================
// Merchandising Teams — flat master (0251). Legacy "Merchandising Team" form:
// Short Name · Inactive · Name · Location (→ locations, select-only) + is_draft.
// ============================================================================

export interface MerchandisingTeam {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  inactive: boolean;
  location_id: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  location?: { id: string; name: string } | null;
}

const nullableText = z.string().optional().nullable();

export const merchandisingTeamInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  inactive: z.boolean().default(false),
  location_id: z.string().uuid().nullable().default(null),
  is_draft: z.boolean().default(false),
});
export type MerchandisingTeamInput = z.infer<typeof merchandisingTeamInput>;
