import { z } from "zod";

export const PARTY_TYPES = ["vendor", "buyer"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  vendor: "Vendor",
  buyer: "Buyer",
};

export const BALANCE_TYPES = ["dr", "cr"] as const;
export type BalanceType = (typeof BALANCE_TYPES)[number];

export const BALANCE_TYPE_LABELS: Record<BalanceType, string> = {
  dr: "Debit (Dr)",
  cr: "Credit (Cr)",
};

export interface PartyOpening {
  id: string;
  party_type: PartyType;
  vendor_id: string | null;
  buyer_id: string | null;
  currency_code: string | null;
  opening_balance: number;
  balance_type: BalanceType;
  as_of_date: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const partyOpeningInput = z
  .object({
    party_type: z.enum(PARTY_TYPES),
    vendor_id: z.string().uuid().optional().nullable(),
    buyer_id: z.string().uuid().optional().nullable(),
    currency_code: z.string().optional().nullable(),
    opening_balance: z.coerce.number().default(0),
    balance_type: z.enum(BALANCE_TYPES).default("dr"),
    as_of_date: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
  })
  .refine((v) => (v.party_type === "vendor" ? !!v.vendor_id : !!v.buyer_id), {
    message: "Select the party (vendor or buyer)",
    path: ["party_type"],
  });
export type PartyOpeningInput = z.infer<typeof partyOpeningInput>;
