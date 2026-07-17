import { z } from "zod";

// ============================================================================
// Divisions — header-only master. System submodule.
// Division ID · Division Name · Document Prefix ID · Blocked.
// ============================================================================
export interface Division {
  id: string;
  division_id: string | null;
  division_name: string | null;
  document_prefix_id: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const divisionInput = z.object({
  division_id: z.string().optional().nullable(),
  division_name: z.string().optional().nullable(),
  document_prefix_id: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type DivisionInput = z.infer<typeof divisionInput>;
