import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

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
  /**
   * Optional link to the `customers` master for the same party (0380).
   *
   * Orders hang off `buyers`; nominated / recommended vendor lists hang off
   * `customers`. Two tables, historically unrelated, with no overlapping names
   * in the live data — so a nomination-aware field on an order (Trims ▸ Vendor)
   * has nothing to narrow by until an operator sets this. Null is a legitimate,
   * default state: the field then offers every vendor and says why.
   */
  customer_id: string | null;
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

// `capsName` rather than a `.toUpperCase()` in the action: these schemas are
// ALSO what lib/data-io parses a spreadsheet import with, and that path writes
// straight to Postgres without touching an action. See capsName's doc comment.
export const buyerInput = z.object({
  code: z.string().min(1, "Code required"),
  name: capsName("Name required"),
  country: capsTextNullable(),
  currency_code: z.string().optional().nullable(),
  contact_email: z.string().email().optional().or(z.literal("")).nullable(),
  contact_phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  /** See `Buyer.customer_id` — the link that lets an order reach nominations. */
  customer_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type BuyerInput = z.infer<typeof buyerInput>;

export const itemInput = z.object({
  code: z.string().min(1),
  name: capsName(),
  category: capsTextNullable(),
  uom_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ItemInput = z.infer<typeof itemInput>;

export const uomInput = z.object({
  code: z.string().min(1),
  name: capsName(),
  is_active: z.boolean().default(true),
});
export type UomInput = z.infer<typeof uomInput>;
