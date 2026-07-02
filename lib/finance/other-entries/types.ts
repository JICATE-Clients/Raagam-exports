import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const ENTRY_TYPES = ["income", "expense"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  income: "Income",
  expense: "Expense",
};

export function entryTypeTone(t: EntryType): StatusTone {
  return t === "income" ? "success" : "warning";
}

export interface OtherEntry {
  id: string;
  code: string | null;
  entry_type: EntryType;
  category: string | null;
  description: string;
  amount: number;
  currency_code: string | null;
  entry_date: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const otherEntryInput = z.object({
  entry_type: z.enum(ENTRY_TYPES),
  category: z.string().optional().nullable(),
  description: z.string().min(1, "Description required"),
  amount: z.coerce.number().nonnegative().default(0),
  currency_code: z.string().optional().nullable(),
  entry_date: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type OtherEntryInput = z.infer<typeof otherEntryInput>;
