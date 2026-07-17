import { z } from "zod";

// ============================================================================
// Our Banks — header-only master. Associates submodule.
// Account No · Account Name · Bank Name · Branch Name · Swift Code ·
// IFSC Code · Address · Blocked.
// ============================================================================
export interface OurBank {
  id: string;
  account_no: string | null;
  account_name: string | null;
  bank_name: string | null;
  branch_name: string | null;
  swift_code: string | null;
  ifsc_code: string | null;
  address: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const ourBankInput = z.object({
  account_no: z.string().optional().nullable(),
  account_name: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  branch_name: z.string().optional().nullable(),
  swift_code: z.string().optional().nullable(),
  ifsc_code: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type OurBankInput = z.infer<typeof ourBankInput>;
