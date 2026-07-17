import { z } from "zod";

// ============================================================================
// Packing Instructions — header-only master (Materials submodule).
// Fields: packing_no, packing_type (req), packing_type_new_old (N/O),
// reference, instructions (long text), packing_charges (numeric), inactive.
// ============================================================================
export interface PackingInstruction {
  id: string;
  packing_no: string | null;
  packing_type: string;
  packing_type_new_old: string | null;
  reference: string | null;
  instructions: string | null;
  packing_charges: number | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const packingInstructionInput = z.object({
  packing_no: z.string().optional().nullable(),
  packing_type: z.string().min(1, "Packing type is required"),
  packing_type_new_old: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  packing_charges: z.number().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type PackingInstructionInput = z.infer<typeof packingInstructionInput>;
