import { z } from "zod";

// ============================================================================
// States — GST master (0262). Legacy EDP2 "State" form: Code (GST state code) ·
// Default · Blocked · State (name). Minimal code/name master with flags.
// ============================================================================

export interface State {
  id: string;
  code: string | null; // GST state code
  name: string;
  is_default: boolean;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const stateInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "State name is required"),
  is_default: z.boolean().default(false),
  blocked: z.boolean().default(false),
});
export type StateInput = z.infer<typeof stateInput>;
