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
  /**
   * Which country this state belongs to — nullable FK to `public.countries`.
   *
   * The column is not in 0262; it was added later, and `uq_states_name` (0373)
   * is scoped on it: `(country_id, lower(trim(name)))` with `nulls not distinct`.
   * It is surfaced on the type so the State FIELDS can scope their list — an
   * Indian GST state is not a valid answer under a foreign country, and "GEORGIA"
   * is both a US state and a sovereign country's own.
   *
   * **null means the home country.** Every row this app created before the State
   * picker started writing the column sits at null, and the master ships as the
   * Indian GST list (codes 01–38), so an unscoped row is an Indian one. Back-
   * filling those to India is a data migration, not a default — see
   * `state-picker.tsx`, which treats null as home rather than as unknown.
   */
  country_id: string | null;
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
