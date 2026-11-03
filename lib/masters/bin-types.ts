import { z } from "zod";

// ============================================================================
// Bins — Materials master (0278). Legacy EDP2 "Bin" form:
// Bin Code (req) · Location (opt → locations FK) · Description · Blocked.
// STORE, MANDATORY (0800, user 2026-11-03): a bin is a rack IN a store room, and its
// unit is the store's (a trigger sets location_id; the form no longer asks for it). A
// blank Bin Code is numbered from the store's Bin Prefix (createBin).
// ============================================================================
export interface Bin {
  id: string;
  bin_code: string | null;
  store_id: string;
  location_id: string | null;
  description: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display (bin-service selects locations(id,code,name))
  location?: { id: string; code: string | null; name: string } | null;
  // embedded for display (bin-service selects stores(id,code,name))
  store?: { id: string; code: string | null; name: string } | null;
}

export const binInput = z.object({
  // Blank = number it from the store's Bin Prefix (createBin refuses if the store has none).
  bin_code: z.string().optional().default(""),
  store_id: z.string().uuid({ message: "Pick the store this bin is in" }),
  description: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type BinInput = z.infer<typeof binInput>;
