import { z } from "zod";

// ============================================================================
// Colors — header-only master. Materials submodule.
// Color Name · Blocked.
// ============================================================================
export interface Color {
  id: string;
  color_name: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const colorInput = z.object({
  color_name: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type ColorInput = z.infer<typeof colorInput>;
