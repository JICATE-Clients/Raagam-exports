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
  // Blank = number it from the store's old Bin Prefix (only stores saved before 2026-11-04
  // have one; createBin refuses otherwise). New bins come from binRangeInput below.
  bin_code: z.string().optional().default(""),
  store_id: z.string().uuid({ message: "Pick the store this bin is in" }),
  description: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type BinInput = z.infer<typeof binInput>;

/**
 * THE NEW-BIN FORM: Store · Prefix · From · To · Description (client 2026-11-04,
 * record-1793767100093). One entry makes PREFIX + From … PREFIX + To — STR- 1 to 20 is
 * STR-01 … STR-20 — and a rack bought later is the same form with From = To = 21. To
 * blank = one bin. Prefix and range are NOT stored: they only name the bins they make.
 */
export const BIN_RANGE_MAX = 500;
export const binRangeInput = z
  .object({
    store_id: z.string().uuid({ message: "Pick the store these bins are in" }),
    prefix: z.string().trim().min(1, "Enter the bin prefix, e.g. STR-"),
    from_no: z.string().trim().regex(/^\d+$/, "From must be a whole number"),
    to_no: z.string().trim().regex(/^\d*$/, "To must be a whole number").optional().default(""),
    description: z.string().optional().nullable(),
    inactive: z.boolean().default(false),
  })
  .refine((v) => !v.to_no || Number(v.to_no) >= Number(v.from_no), {
    message: "To must not be less than From",
  })
  .refine((v) => (Number(v.to_no || v.from_no) - Number(v.from_no)) + 1 <= BIN_RANGE_MAX, {
    message: `At most ${BIN_RANGE_MAX} bins in one go`,
  });
export type BinRangeInput = z.infer<typeof binRangeInput>;

/**
 * The codes a range makes. Numbers are at least two digits (STR-01, as the client said
 * it), wider when From or To is typed wider: 1–100 → 001…100, 001–010 → 001…010.
 */
export function binRangeCodes(prefix: string, fromNo: string, toNo: string): string[] {
  const p = prefix.trim().toUpperCase();
  const to = toNo.trim() || fromNo.trim();
  const width = Math.max(2, fromNo.trim().length, to.length);
  const out: string[] = [];
  for (let n = Number(fromNo); n <= Number(to); n++) out.push(`${p}${String(n).padStart(width, "0")}`);
  return out;
}
