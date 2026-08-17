import { z } from "zod";
import { normName } from "./name-dictionary";

// ============================================================================
// Size Groups — parent-child master (size_groups + size_group_sizes).
// Each Size Group holds an ordered list of named sizes used for garment
// order grids, packing lists, and BOM breakdowns.
// ============================================================================

export interface SizeRow {
  id: string;
  size_name: string;
  sort_order: number | null;
}

export interface SizeGroup {
  id: string;
  size_group_no: string | null;
  size_group_name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  sizes?: SizeRow[];
}

/**
 * THE NAME NORMALISES ON THE WRITE PATH, AND THAT IS WHAT MAKES 0425'S UNIQUE
 * INDEX SAFE TO ADD.
 *
 * `normName` — trim, COLLAPSE INTERNAL WHITESPACE, uppercase — is the same
 * transform 0425 mirrors in SQL. `capsName()` is the usual helper here and is
 * deliberately NOT used: it trims and uppercases but does not collapse, so
 * "MENS  TOP" would still reach Postgres as a distinct string from "MENS TOP"
 * and the index would reject a save the app had just accepted. Collapsing here
 * instead means `guardName` — which is called with the PARSED value — catches
 * that collision itself and answers with a sentence rather than a 23505.
 *
 * It is also the schema, not the action, on purpose: `lib/data-io` parses with
 * these very schemas and writes straight to Postgres (AGENTS.md "CAPITALS").
 * Size Groups has no data-io entity today, but the rule does not depend on that.
 *
 * Validate BEFORE transforming — `.min()` cannot be chained after a Zod
 * transform, so a whitespace-only name must fail as empty rather than pass as "".
 */
export const sizeGroupInput = z.object({
  /** Blank on create → the action auto-generates a unique group no. from the
   *  name (client 2026-07-23: don't ask users for a code). Edit passes the
   *  existing no. through unchanged. */
  size_group_no: z.string().optional().nullable(),
  /** Was `optional().nullable()`, which let a group save with NO NAME AT ALL —
   *  and an unnamed group is unpickable and unmergeable. Both surfaces already
   *  require it client-side (`canSave`), so this only writes down what they
   *  both already enforce. */
  size_group_name: z.string().trim().min(1, "Name is required").transform(normName),
  inactive: z.boolean().default(false),
});
export type SizeGroupInput = z.infer<typeof sizeGroupInput>;

/**
 * One size under a group. `children` arrives as a server-action argument, so it
 * is untrusted input like any other and had NO schema at all before this — the
 * action took a bare TS type and pushed it to Postgres.
 *
 * Parsed AFTER the action's `normalize()` has dropped blank rows, so `min(1)` is
 * a genuine post-condition rather than a rule that would reject the empty last
 * row every grid carries.
 */
export const sizeChildInput = z.object({
  size_name: z.string().trim().min(1, "Size is required").transform(normName),
  sort_order: z.number().int().nullable(),
});
export const sizeChildrenInput = z.array(sizeChildInput);
export type SizeChildInput = z.infer<typeof sizeChildInput>;
