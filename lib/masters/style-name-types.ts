import { z } from "zod";

// ============================================================================
// Style Names — header-only master (Materials submodule).
// Simple record: short_name (unique, required) + inactive flag.
// ============================================================================
export interface StyleName {
  id: string;
  short_name: string;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const styleNameInput = z.object({
  short_name: z.string().min(1, "Short name is required"),
  inactive: z.boolean().default(false),
});
export type StyleNameInput = z.infer<typeof styleNameInput>;
