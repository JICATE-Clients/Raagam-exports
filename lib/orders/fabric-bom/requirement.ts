/**
 * Fabric BOM — how much finished fabric an order needs.
 *
 *     Fabric Required = Production Target x Consumption per garment
 *                       x (1 + Wastage %)
 *
 * Step 3 of the client's order flow. Material BOM's engine
 * (`../material-bom/requirement.ts`) answers the same question for trims, and
 * THE TARGET HALF OF IT IS SHARED RATHER THAN COPIED: `productionSlices` resolves
 * order qty + excess + approval pieces + rejection allowance into slices, and
 * this module filters those slices and multiplies. A second excess calculation is
 * how two screens start reporting different quantities for one order —
 * `doc/orders-six-step.md` says so about these two steps by name.
 *
 * What is NOT shared is the arithmetic on the line, and that is the real
 * difference between the documents. A trim is a RATIO — `no_of_items` per
 * `per_pieces`, because 2 labels cover 1 piece and 1 metre of tape covers 4.
 * Fabric is one consumption figure per garment. Running fabric through the ratio
 * would leave every line carrying `per_pieces = 1`.
 *
 * Client-safe (no `server-only`), for the reason `approval-qty.ts`,
 * `order-value.ts` and the material engine all record: the figures recalculate as
 * the operator types, so they run in the browser — and the server action computes
 * the STORED requirement from these same functions, which is what stops the
 * number the operator approved and the number a purchase order is checked
 * against from being derived twice.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * Inherited unchanged, and it bites harder here: fabric is the largest line in
 * the order, so a requirement of 0 rendering as "none needed" is the most
 * expensive possible silent answer. Every branch that cannot answer returns a
 * `Refusal` carrying the SENTENCE the screen prints.
 */

import {
  isRefusal,
  productionSlices,
  type OrderProductionInput,
  type ProductionSlice,
  type Refusal,
} from "@/lib/orders/material-bom/requirement";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";

export type { ProductionSlice, Refusal };
export { isRefusal };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * How a fabric line's requirement splits.
 *
 * ## THERE IS NO `order` BASIS, AND THAT IS NOT AN OVERSIGHT
 *
 * The Material BOM has one, because a polybag is a polybag whatever colour the
 * garment inside it is — one bulk figure for the order is a correct answer for a
 * trim. Fabric is DYED PER COLOURWAY. A single un-split kilo figure names no lot
 * anyone can knit or dye, and would be handed to purchasing as though it did.
 *
 * ## `colour_size` IS SPELLED OUT BECAUSE `size` MEANS THE OPPOSITE NEXT DOOR
 *
 * The material engine's `size` basis deliberately COLLAPSES the colour axis: a
 * Medium label is a Medium label across every colourway, so emitting `WHITE · M`
 * and `NAVY · M` separately would double the rows and ask the operator to
 * reconcile two numbers that are only ever added back together. Its header calls
 * conflating the two "a bug this module shipped once".
 *
 * Collapsing colour is exactly what a dyed fabric cannot do. So the fabric value
 * that splits by size is the material engine's `combination` — every (colour,
 * size) cell — and it is named `colour_size` rather than `size` so that the two
 * tables cannot be read as agreeing when they mean opposite things. The mapping
 * lives in `materialBasisFor` below and nowhere else.
 */
export const FABRIC_BASES = ["colour", "colour_size"] as const;
export type FabricBasis = (typeof FABRIC_BASES)[number];

/**
 * SHORT ON PURPOSE — these are read inside a grid cell about 110px wide, under a
 * column headed "Split". "Colour-wise" truncated to "C…" there, which is not a
 * shorter label but an unreadable one; the header supplies the "-wise".
 */
export const FABRIC_BASIS_LABELS: Record<FabricBasis, string> = {
  colour: "Colour",
  colour_size: "Col + Size",
};

/**
 * Normalise a stored basis, refusing anything unrecognised.
 *
 * EMPTY-AND-EXPLAIN, NEVER A FALLBACK TO 'colour'. A silent fallback makes the
 * choice advisory and the operator never learns it needs making — the lesson the
 * nominated-vendor rule records twice, and the material engine's `basisOf`
 * records a third time.
 */
export function fabricBasisOf(v: string | null | undefined): FabricBasis | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (FABRIC_BASES as readonly string[]).includes(k)
    ? (k as FabricBasis)
    : { refused: "Choose how this fabric splits" };
}

/** The material engine's basis this one explodes through. The ONE place the two
 *  vocabularies are related — see the note on `FABRIC_BASES`. */
function materialBasisFor(basis: FabricBasis): "colour" | "combination" {
  return basis === "colour" ? "colour" : "combination";
}

// ---------------------------------------------------------------------------
// The slices a line covers
// ---------------------------------------------------------------------------

/** Which part of the order a fabric line is for. Both null = the whole order. */
export type FabricLineScope = {
  /** NULL = every style on the order. */
  style_ref_no: string | null;
  /** NULL = every colourway. */
  combo: string | null;
};

/** A fabric BOM line, as much of it as the requirement needs. */
export type FabricLineInput = {
  /** Fabric per garment, in the consumption unit. */
  consumption: number | null;
  /** The CUTTING room's buffer. Not process loss — that is step 4, and applying
   *  it here as well charges the same loss twice. */
  wastage_pct: number | null;
  /** `uoms.decimal_places_allowed` of the consumption unit. */
  decimals: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const comboKey = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * The rows one fabric line explodes into.
 *
 * ## THE WHOLE ORDER IS VALIDATED BEFORE THE LINE IS FILTERED, DELIBERATELY
 *
 * `productionSlices` refuses the ENTIRE explosion when the Combos tab and the
 * Approval Qty tab disagree — a colour declared with no quantity, or quantified
 * under a name the Combos tab no longer lists. Filtering first and validating the
 * remainder would hide exactly that: a line scoped to WHITE would compute
 * happily while NAVY, on the next line, was the one carrying the disagreement,
 * and the BOM would be short by a colourway with nothing on screen saying so.
 *
 * So the order answers first, and only then does the line take its share. This
 * costs one extra explosion per line and buys a refusal that names the tab to go
 * and fix.
 *
 * ## A SCOPE THAT MATCHES NOTHING IS A REFUSAL, NOT AN EMPTY LIST
 *
 * An empty list would multiply out to no requirement rows at all, which renders
 * as a line that needs no fabric. That is the same "0 is not an answer" call the
 * header makes, one level up.
 */
export function fabricSlices(
  basis: FabricBasis,
  scope: FabricLineScope,
  order: OrderProductionInput,
): ProductionSlice[] | Refusal {
  /*
   * FABRIC CARRIES THE FULL TARGET — REJECTION INCLUDED. THE QUESTION IS ANSWERED.
   *
   * This block asked, from 2026-08-21 until now, "whether fabric should carry
   * the full target, rejection included, is a live question raised with the
   * client and not yet answered". It is answered: it should.
   *
   *     fabric   = qty + excess + approval + REJECTION   ("full_target")
   *     accessory = qty + excess + approval              ("po_excess_approval")
   *
   * ## THE DISTINCTION IS THE CLIENT'S AND IT CUTS BOTH WAYS
   *
   * A garment rejected during panel processing or printing has already consumed
   * its FABRIC and has not yet consumed its trims. That is why the accessory
   * rule excludes the buffer — buying it over-orders every hangtag and carton —
   * and it is the same sentence, read from the other end, that says fabric must
   * include it. Cloth for a garment that will be cut and thrown away still has
   * to be bought.
   *
   * ## FABRIC AND MATERIAL NOW PLAN DIFFERENT QUANTITIES, BY DESIGN
   *
   * `productionSlices` was shared between the two so they could never report
   * different numbers for one order. That premise has changed shape rather than
   * broken: it is now ONE function with THREE declared rules, and the sharing
   * still guarantees the thing that matters — one apportionment, one size curve,
   * one set of refusals. What differs is the single quantity each rule starts
   * from, stated at the call site where a reader can see which one applies.
   *
   * Passing the rule here rather than leaving the default remains the whole
   * guard: `productionSlices` defaults to the MATERIAL rule, so silence would
   * move fabric back.
   *
   * ## HOW FABRIC CAME TO BE ON THE ENTERED QUANTITY AT ALL
   *
   * Not by a decision about fabric. `check-fabric-bom.mts` records it: when the
   * client moved the MATERIAL BOM onto the entered quantity, fabric shared this
   * function and was carried along. Material moved back to `qty + excess +
   * approval` on 2026-08-21; fabric never followed, and sat on a rule nobody had
   * chosen for it. Reverting is one word here — `"entered_only"` is kept live
   * in `BaseQuantityRule` for exactly that reason.
   */
  const all = productionSlices(materialBasisFor(basis), order, "full_target");
  if (isRefusal(all)) return all;

  const wantStyle = scope.style_ref_no == null ? null : styleKey(scope.style_ref_no);
  const wantCombo = scope.combo == null ? null : comboKey(scope.combo);

  const mine = all.filter(
    (s) =>
      (wantStyle === null || styleKey(s.style_ref_no) === wantStyle) &&
      (wantCombo === null || comboKey(s.combo) === wantCombo),
  );

  if (mine.length === 0) {
    // Name what was asked for. "No slices" tells the operator nothing; "NAVY is
    // not on this order" tells them whether the line or the order is wrong.
    const asked = [scope.style_ref_no, scope.combo].filter(Boolean).join(" · ");
    return {
      refused: asked
        ? `${asked} is not a colourway on this order`
        : "This order has no quantified colourways",
    };
  }
  return mine;
}

// ---------------------------------------------------------------------------
// The requirement
// ---------------------------------------------------------------------------

/**
 * One slice's fabric requirement, in the consumption unit.
 *
 *     ceilToPrecision(qty x consumption x (1 + wastage/100), dp)
 *
 * `wastage_pct` multiplies the FABRIC figure, never the pieces. The order's
 * Excess % is a different number and is already inside `slice.qty`; applying a
 * second percentage to the pieces would compound two buffers invisibly. The
 * material engine records the same reasoning for its own Wastage column.
 *
 * ROUNDED UP, at the consumption UOM's own precision. Fabric is issued in whole
 * units of whatever it is measured in, and rounding a shortfall down is a
 * shortfall on the cutting table.
 */
export function fabricRequirementFor(
  line: FabricLineInput,
  slice: ProductionSlice,
): number | Refusal {
  const consumption = num(line.consumption);
  const wastage = num(line.wastage_pct) ?? 0;

  // 0 is not "no fabric needed" — every grid opens on a blank row (the seedRow
  // rule) and a half-filled one carries 0. Same call `styleRate` makes for a
  // price of 0 and `requirementFor` makes for a count of 0.
  if (consumption == null || consumption <= 0) {
    return { refused: "Enter the fabric consumption per garment" };
  }
  if (wastage < 0 || wastage > 100) return { refused: "Wastage must be between 0 and 100" };

  const qty = num(slice.qty) ?? 0;
  return ceilToPrecision(qty * consumption * (1 + wastage / 100), uomPrecision(line.decimals));
}

/**
 * Every requirement row one line produces, or the first refusal.
 *
 * The screen and the server action both call THIS rather than pairing
 * `fabricSlices` with `fabricRequirementFor` themselves — two call sites pairing
 * them by hand is two places for the order of the two steps, or the handling of a
 * refusal, to drift.
 */
export type FabricRequirementRow = ProductionSlice & { required: number };

export function fabricRequirementRows(
  basis: FabricBasis,
  scope: FabricLineScope,
  line: FabricLineInput,
  order: OrderProductionInput,
): FabricRequirementRow[] | Refusal {
  const slices = fabricSlices(basis, scope, order);
  if (isRefusal(slices)) return slices;

  const out: FabricRequirementRow[] = [];
  for (const s of slices) {
    const required = fabricRequirementFor(line, s);
    // ONE BAD LINE REFUSES THE WHOLE LINE, not the slice. A partial explosion is
    // the dangerous one: emitting two colours of three yields a smaller total
    // that looks exactly like a correct answer. The material engine makes the
    // same call one level up, in `productionSlices`.
    if (isRefusal(required)) return required;
    out.push({ ...s, required });
  }
  return out;
}

/**
 * A line's total across every slice it explodes into.
 *
 * NO MOQ HERE, and its absence is the one thing about this function worth
 * knowing. `moqRollup` exists on the material side because a supplier's minimum
 * is a minimum per ORDER and a colour-wise explosion would otherwise apply it six
 * times. Fabric is not bought against an MOQ in this business — it is knitted to
 * order — so importing that rollup would add a control nothing sets and a number
 * nobody can explain. Step 4 is where a fabric quantity meets a supplier.
 */
export function fabricLineTotal(rows: readonly FabricRequirementRow[]): number {
  return rows.reduce((a, r) => a + r.required, 0);
}
