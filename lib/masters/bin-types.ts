import { z } from "zod";

// ============================================================================
// Bins — Materials master (0278). Legacy EDP2 "Bin" form:
// Bin Code (req) · Location (opt → locations FK) · Description · Blocked.
// ============================================================================
export interface Bin {
  id: string;
  bin_code: string | null;
  location_id: string | null;
  description: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display (bin-service selects locations(id,code,name))
  location?: { id: string; code: string | null; name: string } | null;
}

export const binInput = z.object({
  bin_code: z.string().min(1, "Bin code is required"),
  location_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type BinInput = z.infer<typeof binInput>;
