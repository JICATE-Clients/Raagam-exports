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
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  is_active: z.boolean().default(true),
});
export type PrintTypeInput = z.infer<typeof printTypeInput>;
