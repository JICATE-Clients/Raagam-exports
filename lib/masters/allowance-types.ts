import { z } from "zod";

// ============================================================================
// Allowances — HR master (0254). Legacy EDP2 "Allowance" form: auto ID · Name ·
// Sequence · Type (Allowance / Other Allowance) · Base Head / PF Eligible / ESI
// Eligible flags. Selecting "Other Allowance" reveals a Fixed/Variable radio +
// a basis dropdown (unseeded in legacy → free text); both are null for the
// plain "Allowance" type.
// ============================================================================
export const ALLOWANCE_TYPES = ["Allowance", "Other Allowance"] as const;
export const CALC_TYPES = ["Fixed", "Variable"] as const;
export type AllowanceType = (typeof ALLOWANCE_TYPES)[number];
export type CalcType = (typeof CALC_TYPES)[number];

export interface Allowance {
  id: string;
  entry_no: number;
  name: string;
  sequence: number;
  allowance_type: AllowanceType;
  blocked: boolean;
  base_head: boolean;
  pf_eligible: boolean;
  esi_eligible: boolean;
  calc_type: CalcType | null;
  calc_basis: string | null;
  created_at: string;
  updated_at: string;
}

export const allowanceInput = z.object({
  name: z.string().min(1, "Name is required"),
  sequence: z.coerce.number().int().min(0).default(0),
  allowance_type: z.enum(ALLOWANCE_TYPES).default("Allowance"),
  blocked: z.boolean().default(false),
  base_head: z.boolean().default(false),
  pf_eligible: z.boolean().default(false),
  esi_eligible: z.boolean().default(false),
  calc_type: z.enum(CALC_TYPES).nullable().default(null),
  calc_basis: z.string().optional().nullable(),
});
export type AllowanceInput = z.infer<typeof allowanceInput>;
