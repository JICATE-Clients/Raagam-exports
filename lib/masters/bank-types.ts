import { z } from "zod";

// ============================================================================
// Banks — master-detail (0235). Legacy EDP2 "Bank" form: header (Code ·
// Foreign/Local · Name · Blocked) + a "Bank Detail" branch grid. The single
// code column is labelled "Swift Code" (Foreign) / "RTGS/NIFT Code" (Local).
// ============================================================================
export const BANK_TYPES = ["Foreign", "Local"] as const;
export type BankType = (typeof BANK_TYPES)[number];

export interface BankBranch {
  id: string;
  bank_id: string;
  sno: number;
  country_id: string | null;
  state: string | null;
  city: string | null;
  pin: string | null;
  street: string | null;
  land_line: string | null;
  fax: string | null;
  email: string | null;
  swift_rtgs_code: string | null;
  current_acc_no: string | null;
  ifs_code: string | null;
}
export interface Bank {
  id: string;
  code: string | null;
  bank_type: BankType | null;
  name: string;
  blocked: boolean;
  created_at: string;
  updated_at: string;
  branches: BankBranch[];
}

const nullableText = z.string().optional().nullable();
export const bankBranchInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  country_id: z.string().uuid().nullable().default(null),
  state: nullableText,
  city: nullableText,
  pin: nullableText,
  street: nullableText,
  land_line: nullableText,
  fax: nullableText,
  email: nullableText,
  swift_rtgs_code: nullableText,
  current_acc_no: nullableText,
  ifs_code: nullableText,
});
export const bankInput = z.object({
  code: nullableText,
  bank_type: z.enum(BANK_TYPES).nullable().default(null),
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
  branches: z.array(bankBranchInput).default([]),
});
export type BankInput = z.infer<typeof bankInput>;
