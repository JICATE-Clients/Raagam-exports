import { z } from "zod";

export const FACILITY_TYPES = [
  "cc",
  "od",
  "packing_credit",
  "term_loan",
  "bg",
  "lc",
  "other",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  cc: "Cash Credit",
  od: "Overdraft",
  packing_credit: "Packing Credit",
  term_loan: "Term Loan",
  bg: "Bank Guarantee",
  lc: "Letter of Credit",
  other: "Other",
};

export interface BankLimit {
  id: string;
  bank_name: string;
  facility_type: FacilityType;
  limit_amount: number;
  interest_rate: number;
  currency_code: string | null;
  valid_until: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const bankLimitInput = z.object({
  bank_name: z.string().min(1, "Bank name required"),
  facility_type: z.enum(FACILITY_TYPES),
  limit_amount: z.coerce.number().nonnegative().default(0),
  interest_rate: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type BankLimitInput = z.infer<typeof bankLimitInput>;
