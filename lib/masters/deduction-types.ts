import { z } from "zod";

// ============================================================================
// Deductions — HR master (0255). Legacy EDP2 "Deduction" form: auto ID · Blocked ·
// Name · Sequence · Type (Fixed / Variable) · Base Head. Flat header master, the
// simpler sibling of Allowance (0254): the Type radio is the Fixed/Variable calc
// mode itself — there are no PF/ESI eligibility flags and no Allowance/Other wrapper.
// ============================================================================
export const CALC_TYPES = ["Fixed", "Variable"] as const;
export type CalcType = (typeof CALC_TYPES)[number];

export interface Deduction {
  id: string;
  entry_no: number;
  name: string;
  sequence: number;
  calc_type: CalcType | null;
  base_head: boolean;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const deductionInput = z.object({
  name: z.string().min(1, "Name is required"),
  sequence: z.coerce.number().int().min(0).default(0),
  calc_type: z.enum(CALC_TYPES).nullable().default(null),
  base_head: z.boolean().default(false),
  blocked: z.boolean().default(false),
});
export type DeductionInput = z.infer<typeof deductionInput>;
