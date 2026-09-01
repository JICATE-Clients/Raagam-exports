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
 * asks for yarn purchase in the process sequence. It does — in step 4. Fabric
 * BOM says how much FINISHED FABRIC the order needs; Fabric Plan walks knitting
 * and dyeing backwards to the yarn, applying each stage's loss. A yarn line here
 * would be a second, earlier answer to the question step 4 exists to ask, and the
 * two would be reconciled by nobody.
 *
 * ## THE YARN PROCESS TAB (0493) IS THE EXCEPTION, AND IT NARROWS THIS RULE
 *
 * Since 0493 this screen DOES carry yarns, with purchase weights — read that
 * migration before concluding the paragraph above is out of date, because the
 * two are consistent in a way worth stating.
 *
 * The boundary above is about a fabric BOM LINE, which is what this file governs
 * and which is still fabrics only: a yarn must never appear in `getFabricRows`.
 * The Yarn Process tab holds no lines. Its rows are DERIVED from the
 * compositions of the fabrics the lines already name, the planner cannot add
 * one, and its arithmetic runs the other way — it divides a fabric requirement
 * into the yarns that fabric is made of, rather than proposing a second answer
 * to how much fabric is needed.
 *
 * What DID move is where the yarn quantity is first stated: 0493 computes it
 * here because the Budget pulls it, where this file's paragraph assumed step 4
 * would be first. `order_fabric_plan_stages` still plans the ROUTE. If the two
 * ever produce different yarn figures, that is a real conflict to take to the
 * client and not a comment to reword — see 0493's header on the formulas.
 */

/** An `items` row, with the one column the filter reads. */
export type FabricOption = {
  id: string;
  code: string | null;
  name: string;
  /** The item CLASS code — `FABRIC`. Null when the item declares none. */
  class_code: string | null;
  /**
   * Solid / Melange — `items.fabric_type_id` resolved to its label (0279's
   * `config_lookups` kind `fabric_type`).
   *
   * THE `Type` COLUMN'S ONLY CORRECT SOURCE, and it took two wrong ones to get
   * here. The cell first showed `fabric_type` (Main vs Trims); it was then
   * pointed at the ORDER's `item_sub_type`, which is right about the CLOTH but
   * wrong about the LINE — the client's "structure stays, fabric changes" rule
   * puts a solid body and a melange sleeve on two lines of the SAME structure,
   * and an order-level answer gives both the same word. This one is a property
   * of the fabric the planner picked, so the two lines differ because their
   * fabrics do. Catalog 2026-09-01: every fabric item carries one.
   */
  fabric_type: string | null;
} & Deactivatable;

/** The item class a Fabric BOM plans. One string, one place — `itemClassForm`
 *  in lib/masters/material-types.ts switches on the same literal. */
export const FABRIC_CLASS_CODE = "FABRIC";

export function isFabricClass(code: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === FABRIC_CLASS_CODE;
}
