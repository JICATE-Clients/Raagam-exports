import { z } from "zod";
import { nullableKind } from "@/lib/validation/formats";

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
  // These three are how money actually reaches us — they go out on proforma
  // invoices and to buyers' banks, where a typo costs a wire, so they are
  // checked on both sides rather than trusted as free text (client 2026-07-28).
  account_no: nullableKind("account"),
  account_name: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  branch_name: z.string().optional().nullable(),
  swift_code: nullableKind("swift"),
  ifsc_code: nullableKind("ifsc"),
  address: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type OurBankInput = z.infer<typeof ourBankInput>;
