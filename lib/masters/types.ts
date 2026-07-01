import { z } from "zod";

export interface Currency {
  code: string;
  name: string;
  symbol: string | null;
}

export interface Uom {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface Buyer {
  id: string;
  code: string;
  name: string;
  country: string | null;
  currency_code: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  category: string | null;
  uom_id: string | null;
  is_active: boolean;
}

export const buyerInput = z.object({
  code: z.string().min(1, "Code required"),
  name: z.string().min(1, "Name required"),
  country: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  contact_email: z.string().email().optional().or(z.literal("")).nullable(),
  contact_phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type BuyerInput = z.infer<typeof buyerInput>;

export const itemInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  uom_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ItemInput = z.infer<typeof itemInput>;

export const uomInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  is_active: z.boolean().default(true),
});
export type UomInput = z.infer<typeof uomInput>;
