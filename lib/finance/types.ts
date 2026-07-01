import { z } from "zod";

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_STATUSES = ["draft", "posted", "reversed"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const PAYABLE_STATUSES = [
  "draft",
  "approved",
  "partially_paid",
  "paid",
  "cancelled",
] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const MATCH_STATUSES = ["unmatched", "matched", "exception"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const RECEIVABLE_STATUSES = [
  "open",
  "partially_received",
  "received",
  "overdue",
  "cancelled",
] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const COST_TYPES = [
  "materials",
  "labour",
  "overhead",
  "freight",
  "other",
] as const;
export type CostType = (typeof COST_TYPES)[number];

// ---------- interfaces ----------
export interface GlAccount {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  is_active: boolean;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  code: string | null;
  entry_date: string;
  narration: string | null;
  reference_type: string | null;
  reference_id: string | null;
  location_id: string | null;
  is_auto: boolean;
  status: JournalStatus;
  reversal_of: string | null;
  total_debit: number;
  total_credit: number;
  created_by: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  gl_account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  sort_order: number;
}

export interface Payable {
  id: string;
  code: string | null;
  vendor_id: string | null;
  purchase_order_id: string | null;
  grn_id: string | null;
  bill_no: string | null;
  bill_date: string | null;
  due_date: string | null;
  currency_code: string | null;
  amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  match_status: MatchStatus;
  status: PayableStatus;
  location_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayablePayment {
  id: string;
  payable_id: string;
  payment_date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Receivable {
  id: string;
  code: string | null;
  buyer_id: string | null;
  shipment_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency_code: string | null;
  amount_fc: number;
  exchange_rate: number;
  amount_inr: number;
  received_fc: number;
  status: ReceivableStatus;
  location_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceivableReceipt {
  id: string;
  receivable_id: string;
  receipt_date: string;
  amount_fc: number;
  exchange_rate: number;
  amount_inr: number;
  reference: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ShipmentCost {
  id: string;
  shipment_id: string;
  cost_type: CostType;
  description: string | null;
  amount: number;
  source: "auto" | "manual";
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
}

// ---------- input schemas ----------
export const glAccountInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  account_type: z.enum(ACCOUNT_TYPES),
  is_active: z.boolean().default(true),
});
export type GlAccountInput = z.infer<typeof glAccountInput>;

export const journalLineInput = z.object({
  gl_account_id: z.string().uuid(),
  debit: z.coerce.number().nonnegative().default(0),
  credit: z.coerce.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type JournalLineInput = z.infer<typeof journalLineInput>;

export const journalEntryInput = z.object({
  entry_date: z.string(),
  narration: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  lines: z.array(journalLineInput).min(2, "A journal needs at least two lines"),
});
export type JournalEntryInput = z.infer<typeof journalEntryInput>;

export const payableInput = z.object({
  vendor_id: z.string().uuid().optional().nullable(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  grn_id: z.string().uuid().optional().nullable(),
  bill_no: z.string().optional().nullable(),
  bill_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
  tax_amount: z.coerce.number().nonnegative().default(0),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PayableInput = z.infer<typeof payableInput>;

export const payablePaymentInput = z.object({
  payable_id: z.string().uuid(),
  payment_date: z.string(),
  amount: z.coerce.number().positive(),
  method: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
});
export type PayablePaymentInput = z.infer<typeof payablePaymentInput>;

export const receivableInput = z.object({
  buyer_id: z.string().uuid().optional().nullable(),
  shipment_id: z.string().uuid().optional().nullable(),
  invoice_no: z.string().optional().nullable(),
  invoice_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  amount_fc: z.coerce.number().nonnegative().default(0),
  exchange_rate: z.coerce.number().positive().default(1),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type ReceivableInput = z.infer<typeof receivableInput>;

export const receivableReceiptInput = z.object({
  receivable_id: z.string().uuid(),
  receipt_date: z.string(),
  amount_fc: z.coerce.number().positive(),
  exchange_rate: z.coerce.number().positive().default(1),
  reference: z.string().optional().nullable(),
});
export type ReceivableReceiptInput = z.infer<typeof receivableReceiptInput>;

export const shipmentCostInput = z.object({
  shipment_id: z.string().uuid(),
  cost_type: z.enum(COST_TYPES),
  description: z.string().optional().nullable(),
  amount: z.coerce.number().nonnegative().default(0),
});
export type ShipmentCostInput = z.infer<typeof shipmentCostInput>;
