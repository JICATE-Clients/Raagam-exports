import { z } from "zod";

// ============================================================================
// Production Sections — master (production_sections).
// section_for: C=Cut, S=Stitch, I=Iron, E=Embroidery, W=Wash, F=Finishing, P=Pack.
// ============================================================================
export const SECTION_FOR = ["C", "S", "I", "E", "W", "F", "P"] as const;
export type SectionFor = (typeof SECTION_FOR)[number];

export const SECTION_FOR_LABELS: Record<SectionFor, string> = {
  C: "Cut",
  S: "Stitch",
  I: "Iron",
  E: "Embroidery",
  W: "Wash",
  F: "Finishing",
  P: "Pack",
};

export interface ProductionSection {
  id: string;
  code: string;
  name: string;
  section_for: SectionFor | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const productionSectionInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  section_for: z.enum(SECTION_FOR).nullable().default(null),
  is_active: z.boolean().default(true),
});
export type ProductionSectionInput = z.infer<typeof productionSectionInput>;
