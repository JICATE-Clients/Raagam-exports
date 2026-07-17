import { z } from "zod";
import { nullableFormat, GST_STATE_RE } from "@/lib/validation/formats";

// ============================================================================
// States — GST master (0262). Legacy EDP2 "State" form: Code (GST state code) ·
// Default · Inactive · State (name). Minimal code/name master with flags.
// ============================================================================

export interface State {
  id: string;
  code: string | null; // GST state code
  name: string;
  is_default: boolean;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const stateInput = z.object({
  code: nullableFormat(GST_STATE_RE, "Enter a 2-digit GST state code (01–38)"),
  name: z.string().min(1, "State name is required"),
  is_default: z.boolean().default(false),
  inactive: z.boolean().default(false),
});
export type StateInput = z.infer<typeof stateInput>;
