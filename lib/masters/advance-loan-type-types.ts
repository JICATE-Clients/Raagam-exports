import { z } from "zod";

// ============================================================================
// Advance & Loan Types — HR master (0257). Legacy EDP2 "Advance and Loan Type"
// form: Short Name (required) · Description · Type (Salary Advance / Monthly
// Repayment / Loan) · Inactive.
// ============================================================================
export const LOAN_TYPES = ["Salary Advance", "Monthly Repayment", "Loan"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export interface AdvanceLoanType {
  id: string;
  short_name: string;
  description: string | null;
  loan_type: LoanType;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const advanceLoanTypeInput = z.object({
  short_name: z.string().min(1, "Short Name is required"),
  description: z.string().optional().nullable(),
  loan_type: z.enum(LOAN_TYPES).default("Salary Advance"),
  inactive: z.boolean().default(false),
});
export type AdvanceLoanTypeInput = z.infer<typeof advanceLoanTypeInput>;
