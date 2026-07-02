import { z } from "zod";

export const BANK_ENTRY_TYPES = [
  "deposit",
  "withdrawal",
  "charge",
  "interest",
  "transfer",
] as const;
export type BankEntryType = (typeof BANK_ENTRY_TYPES)[number];

export const BANK_ENTRY_TYPE_LABELS: Record<BankEntryType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  charge: "Bank charge",
  interest: "Interest",
  transfer: "Transfer",
};

/** +1 credit (money in), -1 debit (money out), 0 neutral. */
export function entrySign(type: BankEntryType): number {
  switch (type) {
    case "deposit":
    case "interest":
      return 1;
    case "withdrawal":
    case "charge":
      return -1;
    case "transfer":
      return 0;
  }
}

export interface BankJournal {
  id: string;
  code: string | null;
  bank_name: string | null;
  entry_type: BankEntryType;
  amount: number;
  currency_code: string | null;
  entry_date: string | null;
  reference: string | null;
  narration: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const bankJournalInput = z.object({
  bank_name: z.string().optional().nullable(),
  entry_type: z.enum(BANK_ENTRY_TYPES),
  amount: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().optional().nullable(),
  entry_date: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  narration: z.string().optional().nullable(),
});
export type BankJournalInput = z.infer<typeof bankJournalInput>;
