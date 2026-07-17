import { z } from "zod";

// ============================================================================
// Certifications — parent-child master (certifications + certification_validities).
// Each Certification tracks compliance/quality certifications held by
// associates, with validity date ranges managed as child records.
// ============================================================================

export interface ValidityRow {
  id: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface Certification {
  id: string;
  certification_name: string;
  description: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
  validities?: ValidityRow[];
}

export const certificationInput = z.object({
  certification_name: z.string().min(1, "Certification name is required"),
  description: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type CertificationInput = z.infer<typeof certificationInput>;
