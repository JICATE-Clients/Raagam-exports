import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const NOTE_TYPES = ["debit", "credit"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  debit: "Debit Note",
  credit: "Credit Note",
};

export const PARTY_TYPES = ["vendor", "buyer"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  vendor: "Vendor",
  buyer: "Buyer",
};

export const NOTE_STATUSES = ["draft", "issued", "settled", "cancelled"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  settled: "Settled",
  cancelled: "Cancelled",
};

export function noteStatusTone(status: NoteStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "settled":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface FinanceNote {
  id: string;
  code: string | null;
  note_type: NoteType;
  party_type: PartyType;
  vendor_id: string | null;
  buyer_id: string | null;
  currency_code: string | null;
  amount: number;
  note_date: string | null;
  reference: string | null;
  reason: string | null;
  status: NoteStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const financeNoteInput = z
  .object({
    note_type: z.enum(NOTE_TYPES),
    party_type: z.enum(PARTY_TYPES),
    vendor_id: z.string().uuid().optional().nullable(),
    buyer_id: z.string().uuid().optional().nullable(),
    currency_code: z.string().optional().nullable(),
    amount: z.coerce.number().nonnegative().default(0),
    note_date: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    reason: z.string().optional().nullable(),
  })
  .refine((v) => (v.party_type === "vendor" ? !!v.vendor_id : !!v.buyer_id), {
    message: "Select the party (vendor or buyer)",
    path: ["party_type"],
  });
export type FinanceNoteInput = z.infer<typeof financeNoteInput>;
