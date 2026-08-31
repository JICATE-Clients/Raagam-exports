/**
 * Material BOM — PROCESS LOSS, and the rounding that lands on top of it.
 *
 * Client 2026-08-29: "for any items undergoing a production process (such as
 * dyeing or printing), the Required Qty must dynamically calculate and include a
 * Process Loss %. The purchased quantity must be inflated by the loss percentage
 * so that the finished yield perfectly meets the order requirements."
 *
 * ## THIS IS THE DECISION 0465 DEFERRED, NOW TAKEN
 *
 * The Loss % column has been on the Processes grid since 0465 and computed
 * NOTHING, saying so in its own comment: "Wiring it into `requirementFor`
 * changes every purchase on a BOM carrying a process, and the loss COMPOUNDS
 * along a chain (`prev_row_uid`), so two stages at 5% is not 10%. That needs its
 * own decision and its own vectors." This file is that decision and those
 * vectors (`scripts/check-process-loss.mts`).
 *
 * ## COMPOUNDING, NOT SUMMING — AND THE REASON IS ALREADY IN THE REPO
 *
 * The client chose sequential compounding (2026-08-29) over the additive
 * alternative, and it is the only choice consistent with what this app already
 * does with MEASURED quantities. `lib/orders/process-chain/chain.ts` states the
 * rule for actual returns:
 *
 *     "THE QUANTITY THAT FEEDS THE NEXT STAGE IS `qty_in`, NEVER `qty_out`.
 *      Send 1,000 greige buttons to the dyer and 960 come back: the printer can
 *      be given 960."
 *
 * That IS compounding. Printing happens on already-dyed buttons, so a 3% print
 * loss applies to the dyed quantity and not to the original. Summing the
 * percentages would have made the PLAN and the ACTUALS use different arithmetic
 * for one physical process — they would diverge on every job, and nobody could
 * say which was wrong.
 *
 * It also under-orders, which is the failure a buffer exists to prevent: summing
 * charges no loss on the safety units the earlier stage had to carry.
 *
 * ## A CHAIN WALK, THOUGH THE CHAIN IS FLAT TODAY
 *
 * `prev_row_uid` is a real column and NOTHING ON THE SCREEN WRITES IT — the
 * lifecycle cells that did were removed on 2026-08-24, so every process row is
 * currently a head and the walk degenerates to "every row, in `sno` order".
 * Written as a walk anyway, on the client's instruction, so that re-enabling
 * those cells needs no rewrite here.
 *
 * ## FAN-OUT IS A DECLARED GAP, AND IT REFUSES RATHER THAN GUESSES
 *
 * `chain.ts`: "A CHAIN IS A TREE. FAN-OUT IS LEGAL, FAN-IN IS NOT. 1,000 buttons
 * come back navy, 400 go on to be engraved and 600 do not." When branches
 * diverge the two paths carry different compounded losses, so ONE Required Qty
 * per line stops being well-defined — there is no single correct number to
 * print, and any of the three obvious answers (max, sum, first branch) is a
 * guess that would be believed.
 *
 * So it refuses, in the shape this screen already uses for an unanswerable
 * requirement: a sentence in the cell instead of a figure. Unreachable today
 * because nothing builds a chain; it is here so the day it becomes reachable is
 * a visible refusal and not a silently wrong purchase order.
 */

import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";
import { isRefusal, type Refusal } from "./requirement";

/**
 * THE STATE A MATERIAL IS PURCHASED IN — raw, uncoloured (client 2026-08-29).
 *
 * "Trims and fabrics are often bought as raw greige stock and colored locally …
 * tracking them as Greige during purchase prevents inventory systems from
 * incorrectly assuming that pre-colored materials are already sitting in the
 * warehouse."
 *
 * ## THIS IS NOT `material_bom_amendment_processes.stage`
 *
 * That column sits on a PROCESS row and means what the material BECOMES — the
 * only value ever seen there is "DYED", and the grid's own note says so: "the
 * stage is WHAT the material becomes ('DYED') and the process is HOW ('TRIMS
 * DYEING')". This one is what the material ARRIVES as. Two ends of one
 * transaction, and 0476's header carries the full argument for why they are two
 * columns: a single field would have to read Greige and Dyed at once the moment
 * a line grew a process.
 *
 * DECLARED HERE because this module already owns the Greige -> Dyed vocabulary,
 * and because 0476's DB default is copied FROM this constant rather than typed
 * beside it — the case-drift trap 0475 documents on this very table.
 *
 * The final colour is deliberately NOT written onto the item at purchase time;
 * it lands when the dyeing transaction completes. That transition belongs to
 * `lib/orders/process-chain/lifecycle.ts`, which already models a stage's
 * `effective_color_id` as "the nearest upstream one … NULL all the way up means
 * the batch is still grey at this stage".
 */
export const PURCHASE_STAGE_GREIGE = "Greige";

/**
 * A process row, as much of it as the loss arithmetic needs.
 *
 * Deliberately structural rather than importing the screen's `ProcRow`: this
 * module is pure and vectorable, and the server's requirement builder passes the
 * DB row while the screen passes its form state.
 */
export type ProcessLossRow = {
  row_uid: string | null;
  /** The stage whose RETURN feeds this one. NULL = a head, fed by greige stock. */
  prev_row_uid: string | null;
  /** Ordering within the line, and the tiebreak for a flat list. */
  sno: number | null;
  /** The stage's own loss percentage. NULL and 0 both mean "no loss here". */
  loss_pct: number | null;
};

function pct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * THE MULTIPLIER A LINE'S PROCESS CHAIN APPLIES — 1 when there is no loss.
 *
 * Returns a `Refusal` only for the two states where a number would be a lie: a
 * loss outside 0..100, and a fan-out (see the header). An EMPTY list is not a
 * refusal — a line with no processes is the ordinary line, and it multiplies by
 * 1. Same call `colourSplits` records for its own empty array.
 *
 * ## WHY 100 IS REFUSED AND NOT MERELY CAPPED
 *
 * A 100% loss means nothing survives the stage, so no finite input satisfies the
 * order; the honest answer is a refusal, not an enormous number. `sliceRequirement`
 * already refuses a Wastage of 100 for the same reason and in the same words, so
 * the two buffers cannot disagree about what an impossible percentage is.
 */
export function compoundLossFactor(
  rows: readonly ProcessLossRow[],
): number | Refusal {
  if (!rows.length) return 1;

  for (const r of rows) {
    const p = pct(r.loss_pct);
    if (p == null) continue;
    if (p < 0 || p >= 100) {
      return { refused: "Process loss must be between 0 and 100" };
    }
  }

  /**
   * FAN-OUT: two stages drawing from the same predecessor. Detected on
   * `prev_row_uid` rather than by walking, so it fires on a genuinely branched
   * chain and not on the flat list every line has today (where every row is a
   * head and `prev_row_uid` is NULL throughout).
   *
   * NULL IS EXCLUDED FROM THE COUNT deliberately. Several heads is not fan-out —
   * it is the flat list, which is what 100% of live lines look like. Fan-out is
   * two rows naming the SAME non-null predecessor.
   */
  const drawnFrom = new Map<string, number>();
  for (const r of rows) {
    if (!r.prev_row_uid) continue;
    drawnFrom.set(r.prev_row_uid, (drawnFrom.get(r.prev_row_uid) ?? 0) + 1);
  }
  for (const n of drawnFrom.values()) {
    if (n > 1) {
      return {
        refused:
          "This line's processes branch — Required Qty is not defined for a branched chain",
      };
    }
  }

  /**
   * THE WALK. Ordered by the chain where there is one, by `sno` where there is
   * not — and the product is the same either way, because multiplication
   * commutes. The order is kept regardless because it is what makes this a walk
   * rather than a fold: when the lifecycle cells come back and a stage's loss
   * becomes conditional on the one before it, the sequence has to be right.
   */
  const ordered = orderedChain(rows);
  let factor = 1;
  for (const r of ordered) {
    const p = pct(r.loss_pct);
    if (p == null || p === 0) continue;
    factor *= 1 + p / 100;
  }
  return factor;
}

/**
 * The rows in the order the material passes through them.
 *
 * Heads first (`prev_row_uid` NULL) in `sno` order, then each row's successor.
 * A row whose predecessor is not in the list is treated as a head rather than
 * dropped: a dangling `prev_row_uid` is bad data, and silently omitting the
 * stage would silently omit its loss.
 *
 * A CYCLE CANNOT HANG THIS. `seen` bounds the walk at one visit per row, so a
 * row pointing at its own descendant stops rather than looping — the same
 * defensive shape `buildApprovalTree` uses.
 */
function orderedChain(rows: readonly ProcessLossRow[]): ProcessLossRow[] {
  const bySno = [...rows].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));
  const known = new Set(
    bySno.map((r) => r.row_uid).filter((u): u is string => !!u),
  );
  const next = new Map<string, ProcessLossRow[]>();
  for (const r of bySno) {
    if (!r.prev_row_uid || !known.has(r.prev_row_uid)) continue;
    const bucket = next.get(r.prev_row_uid);
    if (bucket) bucket.push(r);
    else next.set(r.prev_row_uid, [r]);
  }

  const out: ProcessLossRow[] = [];
  const seen = new Set<ProcessLossRow>();
  const visit = (r: ProcessLossRow) => {
    if (seen.has(r)) return;
    seen.add(r);
    out.push(r);
    for (const child of r.row_uid ? (next.get(r.row_uid) ?? []) : []) visit(child);
  };
  for (const r of bySno) {
    if (r.prev_row_uid && known.has(r.prev_row_uid)) continue;
    visit(r);
  }
  /* Anything a cycle kept out of the walk still contributes its loss — dropping
     a stage because its links are malformed would under-order silently. */
  for (const r of bySno) visit(r);
  return out;
}

/**
 * UNITS YOU CANNOT BUY A FRACTION OF (client 2026-08-29).
 *
 * ## A DECLARED TABLE, BECAUSE THE MASTER CANNOT ANSWER THIS
 *
 * `uoms.decimal_places_allowed` reads 2 for every row in the live database —
 * GROSS, PCS and NOS exactly as much as MTR and KGS — so there is nothing on the
 * master to tell a countable unit from a measured one. Declaring the list is the
 * same call `hsn-chapter-map.mts` makes and for the reason AGENTS.md gives it:
 * a partition that looks derived but is guessed is the worst of both.
 *
 * It is a list to EDIT when the UOM master grows, and it fails SAFE: a unit not
 * named here keeps its decimals, which is the behaviour every quantity in this
 * app had before today. A missing entry under-rounds a countable unit; a wrong
 * entry would inflate a fabric line, which is the more expensive mistake.
 *
 * "Rolls" is in the client's list and is NOT in the UOM master today. Named
 * anyway, so the day somebody adds it the rule is already right.
 *
 * MATCHED ON `code`, case-folded and trimmed — the idiom `isCircularKnit` uses,
 * and for the same reason: a NAME can be re-typed from the picker's own pencil,
 * and a name match would compile, run and quietly stop rounding.
 *
 * THE IDIOM IS NOT A LICENCE TO LOOK A ROW UP AT ALL. `pieceCoordinateId` used
 * it to find the coordinate called PIECES and was deleted on 2026-08-29 — the
 * rule it served counted coordinates and had no business naming one. This list
 * is the other case: whether a unit is countable is a fact about the UNIT, it
 * exists nowhere else in the schema, and the code is what carries it.
 */
export const WHOLE_UNIT_UOM_CODES: readonly string[] = [
  "GROSS",
  "PCS",
  "NOS",
  "NBR",
  "DZN",
  "CONE",
  "ROLL",
  "ROLLS",
];

export function isWholeUnitUom(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  return !!c && WHOLE_UNIT_UOM_CODES.includes(c);
}

/**
 * ROUND A REQUIREMENT — up to a whole unit where a fraction cannot be bought,
 * to the unit's own precision where it can.
 *
 * ## THIS REVERSES A RECORDED DECISION, AND DOES IT AT THE CALL SITE
 *
 * `uomPrecision` clamps to a FLOOR OF TWO DECIMALS and says why: "Every UOM in
 * the live DB stores 0 in the other precision column, and honouring a 0 renders
 * 16.67 Gross as '17' — quietly reinstating the round-up the client rejected."
 * So whole-unit rounding was asked for, built, and REMOVED once before.
 *
 * The client has now asked for it back by worked example (2026-08-29: "30.6
 * Gross -> round up to 31 Gross"), scoped to countable units only — which is the
 * distinction the first attempt lacked, since clamping applied to metres and
 * kilograms too. The later instruction wins; the earlier one is recorded here
 * rather than tidied away, because the argument against blanket rounding is
 * still correct and will be made again.
 *
 * AND IT IS DONE HERE, NOT IN `uomPrecision`, exactly as that function's own
 * note directs: "A caller that genuinely wants whole units rounds at the call
 * site, where it is visible." Changing the clamp would silently re-round Fabric
 * BOM, Fabric Plan and CAD weights, none of which asked for this.
 *
 * UP, NEVER TO-NEAREST. Shipping short is the failure a material buffer exists
 * to prevent and the cost the other way is at most one unit — `ceilToPrecision`
 * makes the same argument at length.
 */
export function roundRequirement(
  value: number,
  uomCode: string | null | undefined,
  decimals: number | null | undefined,
): number {
  if (!Number.isFinite(value)) return value;
  if (isWholeUnitUom(uomCode)) {
    /**
     * `ceilToPrecision(value, 0)` DOES NOT WORK HERE, and the reason is the
     * clamp documented two paragraphs up: that helper runs its `dp` through
     * `uomPrecision` itself, so a requested 0 becomes 2 and 30.6 Gross comes
     * back as 30.6. Caught by `check-process-loss.mts` on its first run, which
     * is precisely what those vectors are for — the call reads correct, compiles,
     * and silently does nothing.
     *
     * So the ceil is written out, with the `toFixed(6)` that helper carries and
     * for the same stated reason: `150.0000000000001` must ceil to 150, not 151.
     * Without it every clean figure that reached a whole number through a
     * multiplication would gain a unit.
     */
    return Math.ceil(Number(value.toFixed(6)));
  }
  return ceilToPrecision(value, uomPrecision(decimals));
}

/**
 * The finished Required Qty: a base quantity, inflated by the line's process
 * chain, rounded for its unit.
 *
 * ONE FUNCTION SO THE SCREEN AND THE SERVER CANNOT DISAGREE — the same reason
 * `requirementFor` is shared. The screen prints this figure and the server
 * stores it on `material_bom_amendment_requirements`; two implementations of a
 * purchase quantity is two purchase quantities.
 *
 * THE BASE IS ALREADY WASTAGE-INFLATED, and the two buffers are NOT the same
 * thing. `line.excess_pct` is the line's own Wastage % — cutting and handling
 * waste, applied by `requirementFor` — while this is loss at a DYER or PRINTER,
 * declared per process stage. A line can legitimately carry both, and they
 * compose: a 3% cutting wastage on a button that then loses 2% at the dye house
 * needs both buffers or it comes up short. Neither is a restatement of the
 * other, which is why this multiplies rather than takes the larger.
 *
 * A REFUSAL IN GIVES A REFUSAL OUT, unchanged. The requirement grid prints a
 * refusal's sentence in place of the figure, and re-wording it here would lose
 * the one that names what is actually wrong.
 */
export function requiredWithProcessLoss(
  base: number | Refusal,
  rows: readonly ProcessLossRow[],
  uomCode: string | null | undefined,
  decimals: number | null | undefined,
): number | Refusal {
  if (isRefusal(base)) return base;
  const factor = compoundLossFactor(rows);
  if (isRefusal(factor)) return factor;
  if (factor === 1) return base;
  return roundRequirement(base * factor, uomCode, decimals);
}
