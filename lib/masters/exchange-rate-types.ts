import { z } from "zod";

// ============================================================================
// Exchange-rate registers — Currencies master (0253). Legacy EDP2 "Exchange
// rate (Quotes / Orders)" form and its Customs / Imports siblings: a header
// (Entry No auto · Date · For · Effective From) + a grid of Currency → Ex-Rate.
// One table pair, discriminated by `register`.
// ============================================================================

export const EXCHANGE_RATE_REGISTERS = ["quotes_orders", "customs", "imports"] as const;
export type ExchangeRateRegister = (typeof EXCHANGE_RATE_REGISTERS)[number];

/** Month names for the Customs/Imports Month dropdown (index+1 = DB value 1–12). */
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Per-register presentation: the child label, the "For" dropdown values, the
 * rate-column header, and how the entry's period is expressed —
 *   - `effective_from` : a single date (Quotes / Orders — and Imports)
 *   - `month_year`     : a Month + Year pair (Customs).
 * All three registers are confirmed from legacy screenshots.
 */
export const REGISTER_META: Record<
  ExchangeRateRegister,
  {
    label: string;
    forOptions: readonly string[];
    rateLabel: string;
    period: "effective_from" | "month_year";
  }
> = {
  quotes_orders: {
    label: "Exchange rate (Quotes / Orders)",
    forOptions: ["Quotes", "Orders"],
    rateLabel: "Ex-Rate (Exports)",
    period: "effective_from",
  },
  customs: {
    label: "Exchange rate (Customs)",
    forOptions: ["Customs(Export)", "Customs(Import)"],
    rateLabel: "Ex-Rate (Exports)",
    period: "month_year",
  },
  imports: {
    label: "Exchange rate (Imports)",
    forOptions: ["Imports"],
    rateLabel: "Ex-Rate (Imports)",
    period: "effective_from",
  },
};

export interface ExchangeRateLine {
  id: string;
  sno: number;
  currency_code: string;
  ex_rate: number;
}

export interface ExchangeRateEntry {
  id: string;
  register: ExchangeRateRegister;
  entry_no: number;
  entry_date: string;
  rate_for: string | null;
  effective_from: string | null;
  rate_month: number | null;
  rate_year: number | null;
  lines: ExchangeRateLine[];
  created_at: string;
  updated_at: string;
}

export const exchangeRateLineInput = z.object({
  sno: z.coerce.number().int().default(0),
  currency_code: z.string().min(1, "Currency is required"),
  ex_rate: z.coerce.number().default(0),
});

export const exchangeRateInput = z.object({
  register: z.enum(EXCHANGE_RATE_REGISTERS),
  entry_date: z.string().min(1, "Date is required"),
  rate_for: z.string().optional().nullable(),
  effective_from: z.string().optional().nullable(), // Quotes/Orders period
  rate_month: z.coerce.number().int().min(1).max(12).nullable().default(null), // Customs/Imports
  rate_year: z.coerce.number().int().nullable().default(null),
  lines: z.array(exchangeRateLineInput).default([]),
});
export type ExchangeRateInput = z.infer<typeof exchangeRateInput>;
