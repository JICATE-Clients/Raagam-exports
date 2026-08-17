import type { Deactivatable } from "@/lib/masters/inactive";

/**
 * WHICH ITEMS A FABRIC BOM LINE MAY NAME.
 *
 * The mirror of `material-options.ts` one step along, and the same client rule
 * read from the other end: a Material BOM plans Sewing and Packing Accessories,
 * so a Fabric BOM plans FABRIC. Offering a trim here is offering a line that
 * cannot be right, and — worse than on the Material side — a trim named here
 * would be planned by the kilo against a cutting consumption.
 *
 * ## THE CLASS NARROWS; THE `inactive` FLAG NEVER DOES
 *
 * Two different filters, and only one of them may reach the query. The service
 * narrows to the FABRIC class server-side — shipping every item in the database
 * to the browser is a payload question, not a rule, and `getMaterialRows` makes
 * the same call one module along. It does NOT filter on `is_active`: that is the
 * half AGENTS.md's *Disabled rows* section forbids, because the fabric a saved
 * line ALREADY HOLDS would then resolve to nothing — the cell renders empty and
 * the next save writes that emptiness over a real FK. `inactive` is carried
 * through instead, and the picker greys the row and refuses to re-pick it.
 *
 * ## YARN IS NOT OFFERED, AND THAT IS THE STEP BOUNDARY
 *
 * The obvious objection is that a knitted fabric is made of yarn, and the PRD
 * asks for yarn purchase in the process sequence. It does — in step 6. Fabric
 * BOM says how much FINISHED FABRIC the order needs; Fabric Plan walks knitting
 * and dyeing backwards to the yarn, applying each stage's loss. A yarn line here
 * would be a second, earlier answer to the question step 6 exists to ask, and the
 * two would be reconciled by nobody.
 */

/** An `items` row, with the one column the filter reads. */
export type FabricOption = {
  id: string;
  code: string | null;
  name: string;
  /** The item CLASS code — `FABRIC`. Null when the item declares none. */
  class_code: string | null;
} & Deactivatable;

/** The item class a Fabric BOM plans. One string, one place — `itemClassForm`
 *  in lib/masters/material-types.ts switches on the same literal. */
export const FABRIC_CLASS_CODE = "FABRIC";

export function isFabricClass(code: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === FABRIC_CLASS_CODE;
}
