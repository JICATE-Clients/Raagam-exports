import { z } from "zod";

// ============================================================================
// Payment Terms — Associates master (0242). Legacy EDP2 "Payment term" form:
// auto Entry No · Date · Pay Mode · an "AT" phrase (basis · when · event) ·
// With Interest · Credit Days · Description · Blocked. Same shape as Receivable
// Terms but a distinct master (buyer-side payment terms).
// ============================================================================
export const PAY_MODES = ["CHEQUE", "DA", "DD", "DP", "LC", "OTH", "PDC", "TT"] as const;
export const AT_BASIS = ["SIGHT", "OPEN", "DAYS"] as const;
export const AT_WHEN = ["AFTER", "FROM"] as const;
export const AT_EVENT = [
  "SHIPMENT DATE",
  "BL DATE",
  "SIGHT",
  "RECEIPT OF DOCUMENTS",
  "INVOICE DATE",
  "LC OPEN DATE",
] as const;
export type PayMode = (typeof PAY_MODES)[number];
export type AtBasis = (typeof AT_BASIS)[number];
export type AtWhen = (typeof AT_WHEN)[number];
export type AtEvent = (typeof AT_EVENT)[number];

export interface PaymentTerm {
  id: string;
  entry_no: number;
  entry_date: string;
  pay_mode: PayMode | null;
  at_basis: AtBasis | null;
  at_when: AtWhen | null;
  at_event: AtEvent | null;
  with_interest: boolean;
  credit_days: number;
  description: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const paymentTermInput = z.object({
  entry_date: z.string().min(1, "Date is required"),
  pay_mode: z.enum(PAY_MODES).nullable().default(null),
  at_basis: z.enum(AT_BASIS).nullable().default(null),
  at_when: z.enum(AT_WHEN).nullable().default(null),
  at_event: z.enum(AT_EVENT).nullable().default(null),
  with_interest: z.boolean().default(false),
  credit_days: z.coerce.number().int().min(0).default(0),
  description: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type PaymentTermInput = z.infer<typeof paymentTermInput>;
