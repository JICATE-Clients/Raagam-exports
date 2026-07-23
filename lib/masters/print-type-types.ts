import { z } from "zod";

// ============================================================================
// Print Types — master (print_types). Simple code + name master.
// ============================================================================
export interface PrintType {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const printTypeInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  is_active: z.boolean().default(true),
});
export type PrintTypeInput = z.infer<typeof printTypeInput>;
