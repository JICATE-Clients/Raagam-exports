import { z } from "zod";
import { capsName, nullableFormat, GST_STATE_RE } from "@/lib/validation/formats";

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
  // `capsName()` = trim + CAPS, per the standing CAPITALS rule — and load-bearing
  // for the duplicate guard. `checkDuplicateName` matches with `ilike` against the
  // STORED value, so a row saved as "Tamil Nadu " (trailing space) would slip past
  // the guard and then be rejected by `uq_states_name` (0373) — which normalises
  // with `lower(trim(name))` — as a raw Postgres 23505 error. Trimming on the way
  // in keeps the guard and the index agreeing on what a duplicate is. It has to
  // live here rather than in the action: lib/data-io parses imports with this same
  // schema and writes straight to Postgres.
  name: capsName("State name is required"),
  is_default: z.boolean().default(false),
  inactive: z.boolean().default(false),
});
export type StateInput = z.infer<typeof stateInput>;
