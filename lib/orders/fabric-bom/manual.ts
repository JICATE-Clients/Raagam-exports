/**
 * Fabric BOM ▸ Manual — the size-wise gram weights (0494).
 *
 * The client's own framing, kept here because it sets the standard of care:
 * fabric and yarn are 70-80% of a garment order's value, so this tab is "the
 * heart of the material calculation system — any minor error in this screen will
 * collapse the downstream purchasing, knitting, dyeing, and budgeting
 * calculations".
 *
 * ## THE ENTRY IS THE COUNTING UNIT
 *
 * An entry is one fabric structure, a SET of components, and a gram weight per
 * size. The client's own example:
 *
 *     Single Jersey   Front Body + Back Body   60 dia   180 g
 *     Single Jersey   Sleeve                   52 dia    20 g
 *     Rib             Neck                     28 dia    50 g
 *
 * Requirement rows are produced per ENTRY, and `order_fabric_bom_lines` produces
 * none. That is what makes a grouped 180 g multiply ONCE rather than once per
 * component — and it is why the client files "no duplicate component allocation"
 * under bugs to avoid rather than under polish: with each panel used in exactly
 * one entry, the entries PARTITION the garment and their sum is its fabric
 * weight exactly once. `takenComponentIds` below is that rule.
 *
 * ## THIS MODULE DOES NOT MULTIPLY THE ORDER
 *
 * `netKg` and `grossKg` are here because the screen shows them, but the figure
 * that reaches the database goes through `fabricRequirementRows` — the SAME
 * engine the direct route uses, fed `consumption = grams / 1000` through
 * `FabricLineInput.bySize`. The spec's Formula 1 and Formula 2 are exactly
 * `slice.qty x consumption x (1 + wastage/100)`, so there is one multiplication
 * in this codebase and not two. A second one written beside the first is how two
 * screens come to report different fabric for one order.
 *
 * Client-safe (no `server-only`), for `requirement.ts`'s reason: the figures
 * recalculate as the operator types, so they run in the browser — and the server
 * action reads these same functions when it stores the requirement.
 */

import type { Refusal } from "@/lib/orders/material-bom/requirement";

/**
 * How an entry's gram weight is arrived at — the spec's two entry options.
 *
 * THEY BOTH PRODUCE GRAMS, and that is the whole of the distinction. `direct` is
 * the planner typing the weight ("this is the primary method"); `calculated`
 * derives it from the panel measurements and the structure's GSM. `grams` is
 * stored either way, so no downstream reader has to know which mode produced it.
 *
 * TEXT WITH A CHECK, not a lookup table — two fixed answers the business does
 * not add to are a constraint, not a master. Same trade `FABRIC_TYPE_OPTIONS`
 * and `KNIT_TYPE_OPTIONS` already make in types.ts.
 */
export const CALC_MODES = ["direct", "calculated"] as const;
export type CalcMode = (typeof CALC_MODES)[number];

export const CALC_MODE_OPTIONS: { value: CalcMode; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "calculated", label: "Calculated" },
];

/**
 * NORMALISED, and the fallback to 'direct' is not the "silent fallback" the
 * nominated-vendor rule bans.
 *
 * `fabricBasisOf` refuses an unrecognised split because guessing one would plan
 * an order differently. Here 'direct' is what the column DEFAULTs to, what the
 * client calls the primary method, and what an unset entry already means — so an
 * unreadable value resolves to the behaviour already in force rather than to a
 * new one. What it can never do is fabricate a WEIGHT: a direct entry with no
 * `grams` typed is refused by name below.
 */
export function calcModeOf(v: string | null | undefined): CalcMode {
  return (v ?? "").trim().toLowerCase() === "calculated" ? "calculated" : "direct";
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * ONE PANEL A MANUAL ENTRY'S WEIGHT COVERS — a (coordinate, component) PAIR
 * (0569), and the pair is the whole point.
 *
 * A SET ITEM DECLARES ONE COMPONENT UNDER TWO COORDINATES. The order's own
 * declaration is keyed that way already —
 * `garment_order_amendment_style_components (style_ref_no, coordinate_id,
 * component_id, fabric_category_id)` — so "ALL BODY of TOP" and "ALL BODY of
 * BOTTOM" are two panels of one garment wearing one master row. Holding a
 * component id alone cannot tell them apart: the picker listed them once, the
 * Coordinate column printed whichever declaration it found first, and ticking
 * one made the other unreachable (client 2026-09-17, Order #9).
 *
 * `coordinate_id` NULL MEANS "UNSTATED", NEVER "NO COORDINATE" — every row
 * stored before 0569, plus any the migration's backfill could not settle. It
 * collides with every coordinate of its component in `panelTaken`, both ways,
 * exactly as an unscoped `style_ref_no` collides with every style.
 *
 * The LINES side has carried this pair since 0495 (`fabricBomLineInput`'s own
 * comment argues it in as many words). Manual was the outlier.
 */
export type ManualPanel = {
  coordinate_id: string | null;
  component_id: string;
};

/** The identity of a panel, for a Set / Map key. One function, so the picker,
 *  the rules and the screen cannot spell the pair three different ways.
 *  `|` is safe as the separator: neither half is anything but a uuid. */
export function panelKeyOf(p: ManualPanel): string {
  return `${p.coordinate_id ?? ""}|${p.component_id}`;
}

/**
 * THE COMPONENTS A SET OF PANELS TOUCHES, deduped — for the readers that are
 * about the CLOTH rather than about the garment's parts.
 *
 * `stagesForGroup` (yarn-process.ts) resolves a "Component Wise" route by
 * component, because a route step names a component and knows nothing of
 * coordinates; a Set item's two All Body panels run the same route. So the
 * coordinate stops here deliberately: it is what the planner allocates by, not
 * something the arithmetic divides on.
 */
export function componentIdsOf(panels: readonly ManualPanel[]): string[] {
  return [...new Set(panels.map((p) => p.component_id))];
}

/** One size row of one entry, as much of it as the arithmetic needs. */
export type ManualSizeInput = {
  /** `config_lookups` id. NULL is a size the order no longer states. */
  size_id: string | null;
  /** The knitting / finishing diameter — 60 Dia, 52 Dia, 28 Dia. FREE TEXT
   *  since 0566 so it can carry the unit the operator writes ("23 CM"). It is
   *  carried through this module and never computed with: `calculatedGrams`
   *  multiplies `table_width` by `length` by GSM and has never read the dia,
   *  which is what made the column safe to convert. */
  dia: string | null;
  /** The commercial width the cloth is PURCHASED at. A second width, not a
   *  restatement of the dia: cloth is knitted at one and invoiced at another. */
  purchase_width: number | null;
  /** Fabric weight in GRAMS for one garment of this size, for the panels this
   *  entry covers. Typed in direct mode, derived in calculated mode, stored in
   *  both. */
  grams: number | null;
  /**
   * The PANEL width of the cut component, as laid on the cutting table — the
   * planner types it, and it is what the calculated weight multiplies.
   *
   * NOT `dia`, and the two were one word until 0495. `dia` is the fabric ROLL's
   * diameter and is a CONSTRAINT — it says the panels must physically fit across
   * the roll. Multiplying by it instead would give a plausible number wrong by a
   * factor of three, which is the reason the column was renamed rather than
   * left alone.
   */
  table_width: number | null;
  /** The pattern length, in centimetres. */
  length: number | null;
  /** The cutting allowance ADDED TO THE LENGTH (0524) — see `effectiveLength`,
   *  which records the same-day 0523→0524 reversal on this field. */
  length_tolerance: number | null;
  /** "Cons Qty" — units of cloth per garment, typed. NULL means 1; read it
   *  through `consQtyOf` and never with `?? 0`. */
  cons_qty: number | null;
};

/**
 * The metric conversion in the calculated-mode weight, isolated on purpose.
 *
 * CONFIRMED BY THE CLIENT ON 2026-09-03 and no longer provisional. 0494 wrote it
 * as a named constant because the client had said "the exact conversion
 * constants for this formula will be adjusted and verified in a later
 * discussion"; that discussion happened, and the written spec states the formula
 * as `Calculated Width (cm) x Length (cm) x GSM / 10,000`. It stays a named
 * constant read by one expression, because a number that has been confirmed once
 * can be revised again.
 *
 * cm x cm is cm²; /10,000 makes it m²; x gsm (g/m²) makes it grams.
 */
export const GRAMS_CONVERSION = 10_000;

// ---------------------------------------------------------------------------
// The calculated mode
// ---------------------------------------------------------------------------

/**
 * Length after the cutting allowance.
 *
 *     effective length = length + tolerance
 *
 * ## THE TOLERANCE IS ON THE LENGTH — REVERSED BACK 2026-09-03 (0524), HOURS
 * ## AFTER 0523 MOVED IT TO THE WIDTH
 *
 * This function was `calculatedWidth(width, tolerance)` for a few hours on
 * 2026-09-03. 0523 read a *written* spec — *"Tolerance (cm): extra safety
 * margin added to the width"*, *"Calculated Width (cm) = Width + Tolerance"* —
 * and moved the allowance from `length_tolerance` onto a new `width_tolerance`,
 * naming legacy's own `Length | Length Tolerance | Length` band as the earlier
 * (0491) misreading it was correcting.
 *
 * 0524 puts it back on the length, on the operator's explicit instruction
 * after being shown that written spec side by side with a fresh legacy
 * screenshot (2026-09-03 19:58) of this exact band, and confirming twice that
 * the length reading is what is wanted here. The column is `length_tolerance`
 * again rather than reinterpreted in place, for the same reason 0523 renamed
 * it the other way: a column holding one measurement's allowance under the
 * other measurement's name is the "one word for two measurements" fault 0495
 * fixed once already for `table_width`.
 *
 * BOTH READINGS PRODUCE A PLAUSIBLE WEIGHT, which is what let this flip twice
 * in one day without either number looking wrong on screen: a 2 cm allowance
 * is +2.9% on a 70 cm length and +3.8% on a 52 cm width. If this is ever
 * revisited again, that is why a glance at the total will not settle it — go
 * back to whichever written spec is current.
 *
 * ADDED, NOT SCALED. A tolerance beside a measurement in the same unit is an
 * allowance in that unit — a cutting allowance is "2 cm", never "2%". The
 * percentage reading compiles and is wrong by a factor of the length.
 *
 * NULL WHEN THERE IS NO LENGTH. A tolerance on its own is not a length, and
 * returning the tolerance would print a plausible small number in the column
 * the operator reads as the panel.
 */
export function effectiveLength(
  length: number | null | undefined,
  tolerance: number | null | undefined,
): number | null {
  const l = num(length);
  if (l == null) return null;
  return l + (num(tolerance) ?? 0);
}

/**
 * The panel weight this size implies, in GRAMS per garment — the spec's
 * "Piece Weight".
 *
 *     g = table_width(cm) x effectiveLength(cm) x gsm(g/m2) / GRAMS_CONVERSION
 *
 * ## THERE IS NO x2, AND THERE USED TO BE
 *
 * The first cut doubled this for "front and back panel", on the standard
 * knitwear body calculation. The client's spec states the formula without it —
 * the planner types one row per panel group rather than one per garment half —
 * and the doubling was wrong on its own terms for anything that is not a body: a
 * neck rib is ONE panel, and its weight came out twice what it should be. The
 * multiplicity now lives where the planner controls it: in `cons_qty`, and in
 * which components an entry covers.
 *
 * ## GRAMS, NOT KILOGRAMS, AND THAT IS THE UNIT THE WHOLE TAB WORKS IN
 *
 * The planner is given grams, the CAD room measures in grams
 * (`order_cad_component_weights.grams`, 0460), and the client's spec states
 * every weight in grams. The single /1000 to kilograms happens once, in `netKg`,
 * where the order quantity is applied. Converting earlier would put a division
 * inside every cell and a rounding difference between the cell and the total.
 *
 * ## IT RETURNS NULL RATHER THAN A ZERO, THREE TIMES OVER
 *
 * A missing width, a missing length or a missing GSM each mean "not worked out
 * yet", and 0 g is a claim that this size needs no cloth. That is the same
 * "NULL is an answer, 0 is not" rule `requirement.ts` opens with, and it bites
 * hardest on a cell the planner is about to accept as the entry's weight.
 *
 * GSM comes from the ORDER — `garment_order_amendment_combo_structures.gsm`,
 * read through `getOrderFabricSeed` — and is not copied onto the BOM. 0426 made
 * that call for the seed and 0494 keeps it: a copy is a second place for the BOM
 * to disagree with the order about the cloth, and the order is the one that is
 * right.
 */
export function calculatedGrams(
  row: Pick<ManualSizeInput, "table_width" | "length" | "length_tolerance">,
  gsm: number | null | undefined,
): number | null {
  const w = num(row.table_width);
  const l = effectiveLength(row.length, row.length_tolerance);
  const g = num(gsm);
  if (w == null || l == null || g == null) return null;
  if (w <= 0 || l <= 0 || g <= 0) return null;
  return (w * l * g) / GRAMS_CONVERSION;
}

/**
 * The gram weight this size row states — the spec's "Cons Wt" — whichever mode
 * produced it.
 *
 * ONE FUNCTION, READ BY EVERYTHING. The screen prints it, `consumptionMap` feeds
 * it to the engine, and the save writes it — so a direct entry and a calculated
 * entry are indistinguishable to every reader downstream, which is the whole
 * reason `grams` is a stored column rather than a mode-dependent derivation.
 *
 * DIRECT IS THE MODE THAT MATTERS, and the client is explicit about why: *"in
 * garment factories, Direct (Manual) mode is used 99.9% of the time"*, because a
 * CAD or pattern-nesting department computes the panel consumption on marker
 * software and hands the merchandiser the figures. So the typed value is not a
 * fallback for when the formula cannot run — it is the answer, and the formula
 * is the estimate offered when nobody has one.
 */
export function gramsFor(
  mode: string | null | undefined,
  row: ManualSizeInput,
  gsm: number | null | undefined,
): number | null {
  return calcModeOf(mode) === "calculated" ? calculatedGrams(row, gsm) : num(row.grams);
}

// ---------------------------------------------------------------------------
// The spec's arithmetic, for the screen to print
// ---------------------------------------------------------------------------

/**
 * How many units of cloth one garment takes — the spec's "Cons Qty".
 *
 * NULL MEANS ONE, in one place, so nothing downstream has to know. A blank is
 * the ordinary case (one panel set per garment) and the column is deliberately
 * nullable rather than defaulting to 1: a stored default would make a row the
 * planner never touched indistinguishable from one they deliberately set to 1.
 *
 * ZERO AND NEGATIVES ARE REFUSED BY THE COLUMN (`check (cons_qty > 0)`), so this
 * never has to decide what "no cloth per garment" would mean.
 */
export function consQtyOf(row: Pick<ManualSizeInput, "cons_qty">): number {
  return num(row.cons_qty) ?? 1;
}

/**
 * IS THIS A CONS QTY THE COLUMN WILL REFUSE? (client 2026-09-17: Save failed
 * with `order_fabric_bom_manual_sizes_cons_qty_check`.)
 *
 * The header above says the column refuses zero "so this never has to decide
 * what no cloth per garment would mean" — true, but nothing on the way TO the
 * column refused it, so a planner typing 0 for "none" got the raw Postgres
 * error at Save. Blank is the answer for "one per garment"; a typed 0 is NOT
 * rewritten to blank, because that would silently turn it into 1.
 *
 * The test is on the value AS STORED: `numeric(12,4)` rounds first and checks
 * after, so 0.00004 lands as 0.0000 and is refused exactly like 0. One
 * function, read by `manualProblem` (the screen's Save gate) and by the
 * `fabricBomInput` schema (every save path, drafts included).
 */
export function consQtyRefused(v: unknown): boolean {
  const n = num(v);
  return n != null && Math.round(n * 10000) <= 0;
}

/** The sentence both refusals use, so the screen and the server agree. */
export const CONS_QTY_REFUSAL =
  "Cons Qty must be more than 0 — leave it blank for one per garment";

/**
 * Step 1 — Net Weight (Kg) = Order Quantity x Cons Qty x Cons Wt(g) / 1000.
 *
 * The client's worked example: 500 pcs x 1 x 120 g = 60,000 g = 60 kg.
 *
 * `consQty` JOINED THE FORMULA ON 2026-09-03 and its absence was a real gap
 * rather than a simplification: the screen had a `Cons Qty` COLUMN that printed
 * this function's own output, so the multiplier the client's formula names had
 * nowhere to be entered and the column that appeared to hold it held a weight in
 * kilograms instead.
 *
 * FOR DISPLAY. The stored requirement goes through `fabricRequirementRows`,
 * which multiplies the same three figures and rounds UP at the consumption UOM's
 * own precision. This is that arithmetic without the ceiling, so the screen and
 * the database agree to within that rounding and never by a second formula.
 */
export function netKg(
  orderQty: number | null,
  consQty: number | null,
  grams: number | null,
): number | null {
  const q = num(orderQty);
  const c = num(consQty) ?? 1;
  const g = num(grams);
  if (q == null || g == null) return null;
  return (q * c * g) / 1000;
}

/**
 * Step 2 — Required Weight = Net x (1 + Loss₁) x (1 + Loss₂) x …
 *
 * ## THEY COMPOUND, AND ONE OF THEM USED TO BE ALL OF THEM
 *
 * This was `grossKg(net, wastagePct)`, a single allowance. The client's spec
 * states the sequential form, and legacy's own Manual row carries TWO on one
 * line — "EndBit Loss %" and "Component Proc. Loss %" — so a single percentage
 * could not have expressed the row it was reading from.
 *
 * COMPOUNDING IS NOT THE SAME AS ADDING, and the difference is the reason this
 * takes a list rather than a sum. 1% then 5% is x1.0605, not x1.06 — small on
 * two losses, and not small once the Fabric Process route's steps are applied to
 * the same figure. Summing would also make the losses commute with each other in
 * a way the process route's does not.
 *
 * EACH ONE IS VALIDATED, and an out-of-range loss REFUSES rather than clamping:
 * a 150% allowance is a typo, and silently treating it as 100 would triple a
 * purchase without saying so.
 *
 * AN EMPTY LIST IS THE IDENTITY, so a row with no allowances at all returns the
 * net unchanged rather than null.
 */
export function requiredKg(
  net: number | null,
  losses: readonly (number | null | undefined)[],
): number | null {
  const n = num(net);
  if (n == null) return null;
  let factor = 1;
  for (const l of losses) {
    const p = num(l) ?? 0;
    if (p < 0 || p > 100) return null;
    factor *= 1 + p / 100;
  }
  return n * factor;
}

// ---------------------------------------------------------------------------
// Feeding the engine
// ---------------------------------------------------------------------------

/**
 * The per-size consumption, in the LINE's unit, that one entry hands the
 * requirement engine.
 *
 * KEYED BY `size_id`, which is what `ProductionSlice.size_id` carries, so the
 * engine looks a slice's own size up without knowing anything about this tab.
 * `/1000` is the ONE conversion from grams to kilograms in this module — see
 * `calculatedGrams` for why it happens here and not in every cell.
 *
 * A ROW WITH NO SIZE, OR NO WEIGHT, IS SIMPLY ABSENT. `fabricRequirementFor`
 * refuses a slice it cannot find rather than falling back to a scalar, so an
 * absent row is a named refusal and never a quiet zero. A ZERO IS DROPPED for
 * the same reason a grid row opens blank: admitting it would plan a size at no
 * cloth.
 */
export function consumptionMap(
  mode: string | null | undefined,
  rows: readonly ManualSizeInput[],
  gsm: number | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const g = gramsFor(mode, r, gsm);
    if (!r.size_id || g == null || g <= 0) continue;
    /* `consQtyOf` MULTIPLIES HERE, so the engine keeps taking ONE consumption
       per size and knows nothing about the spec's second factor. Net Weight is
       `qty x consQty x grams/1000` (0523) and the engine already applies the
       `qty`; folding `consQty` into the per-garment figure is what keeps that
       true without a second parameter threaded through every caller. */
    out[r.size_id] = (consQtyOf(r) * g) / 1000;
  }
  return out;
}

/**
 * ONE ENTRY'S AVERAGE WEIGHT PER GARMENT, IN KILOGRAMS.
 *
 * Built on `consumptionMap` rather than beside it, which is the whole point:
 * that function already resolves the mode (typed grams vs the calculated
 * formula), already folds `consQtyOf` in — so a garment with two cuffs counts
 * both — and already drops a size with no weight. A footer that re-derived any
 * of that would be a second arithmetic free to disagree with the stored
 * requirement, which is the divergence this module's header exists to forbid.
 *
 * AVERAGED OVER THE SIZES THAT HAVE A WEIGHT, never over every size the order
 * declares. A half-typed grid is the ordinary state of one being typed, and
 * dividing by the sizes not yet reached would report a garment getting lighter
 * with every size added — a figure that moves while nothing about the garment
 * has changed.
 *
 * NULL, NOT 0, when nothing is typed yet. `0 g` is a claim that the garment
 * weighs nothing; the caller shows the row only when there is an answer. Same
 * call `calculatedGrams` makes one section up.
 */
export function averageWeightKg(
  mode: string | null | undefined,
  rows: readonly ManualSizeInput[],
  gsm: number | null | undefined,
): number | null {
  const vals = Object.values(consumptionMap(mode, rows, gsm));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ---------------------------------------------------------------------------
// The rules a screen and a save both enforce
// ---------------------------------------------------------------------------

/** One entry, as much of it as the rules need. */
export type ManualEntryLike = {
  /** NULL = every style on the order (0495). */
  style_ref_no: string | null;
  /**
   * THE CLOTH THIS WEIGHT IS FOR — `items.id`, named directly since 0522.
   *
   * It replaced `structure_id` as the thing the planner chooses: legacy's Manual
   * row has a Fabric column and no Structure column (client 2026-09-03,
   * screenshots 2666 · 2667). The structure is still derived from it on save,
   * because the requirement engine keys its GSM lookup on one — but it is no
   * longer typed, so it is not something these rules may ask for.
   */
  item_id: string | null;
  /** DERIVED from `item_id` (the fabric's `items.category_id`), never typed.
   *  Kept on the shape because `consumptionMap`'s callers still key GSM by it. */
  structure_id: string | null;
  calc_mode: string | null;
  /** WHICH PANELS THIS WEIGHT COVERS — (coordinate, component) PAIRS since
   *  0569, never component ids. See `ManualPanel`. */
  panels: readonly ManualPanel[];
  /** Legacy's "Assort Color wise" checkbox (0522). OFF means this weight is for
   *  EVERY colourway of its style — which is what the engine has always done,
   *  and what it still does. ON means `combos` names them. */
  /**
   * REQUIRED, NOT OPTIONAL — and the `?` is what this bug was (2026-09-16).
   *
   * `entryLike` on the screen builds this object from six fields and never
   * passed this one. Declared optional, that OMISSION TYPECHECKED: the gate
   * read `undefined`, `manualProblem`'s colour-wise branch never ran, and Save
   * was never blocked. The preview then explodes across every colourway and
   * shows a weight while the server stores a refusal with a NULL
   * `required_qty` — the screen and the stored figure disagreeing, which
   * `yarn-process.ts`'s header calls the one thing that must never happen.
   *
   * Making it required is the durable half: the NEXT field added to this rule
   * cannot be silently dropped by a caller, because the compiler names it.
   * A stated rule nothing passes the input to is the "stated vs enforced"
   * hole, and an optional field is how a rule states without enforcing.
   */
  assort_color_wise: boolean;
  /** The colourways this weight is for, when `assort_color_wise` is on (0567).
   *  Read by nothing while the toggle is off, so the ticks survive being
   *  switched off and back on. */
  /**
   * REQUIRED, FOR THE REASON `assort_color_wise` ABOVE IS (2026-09-16, hours
   * apart — and the gap between the two fixes is the lesson).
   *
   * Making that one required did NOT catch this one: `entryLike` began passing
   * the flag and still did not pass the set, and `combos?` let that typecheck.
   * The result was worse than the original bug rather than better — with the
   * flag now visible and the set still `undefined`, `manualProblem`'s
   * `(entry.combos ?? []).length === 0` was true no matter what the operator
   * ticked, so a colour-wise entry was refused with "no colourway is ticked"
   * WHILE THREE WERE. A gate that cannot be satisfied, created by half-fixing
   * a gate that never fired.
   *
   * FIXING ONE OPTIONAL FIELD IN A SHAPE IS NOT FIXING THE SHAPE. Every field
   * these rules read must be required, so that a caller building this object
   * is told about all of them at once rather than one bug at a time.
   */
  combos: readonly string[];
  sizes: readonly ManualSizeInput[];
};

/**
 * THE "NO DUPLICATE COMPONENT ALLOCATION" RULE (client, spec point 5).
 *
 * "Once a component is saved under a fabric entry, it must automatically
 * disappear from the available dropdown selection of any subsequent fabric
 * entries."
 *
 * ## IT IS NOT TIDINESS. IT IS WHAT MAKES THE ARITHMETIC ADD UP.
 *
 * Entries are the counting unit, so the garment's fabric weight is the SUM of
 * its entries. That sum is only correct while the entries partition the panels —
 * a component appearing in two entries is its cloth bought twice, and a
 * component appearing in none is cloth never bought at all. The client lists
 * this under "bugs to avoid", which is exactly the right place for it.
 *
 * ## ENFORCED IN THE DROPDOWN, NOT IN THE DATABASE
 *
 * 0494's header argues it: one BOM covers several styles, and FRONT BODY of a
 * tee and FRONT BODY of a polo are two panels wearing one master row. A
 * `unique (bom_id, component_id)` would reject that at Save, on a document the
 * operator has no way to fix. Withdrawing the option is enforcement at the point
 * of entry — a component that is not offered cannot be chosen — and it is what
 * the client actually asked for.
 *
 * `exceptKey` IS THE ENTRY BEING EDITED, and it is not optional. Without it an
 * entry's own components would be missing from its own dropdown, so opening a
 * saved entry would show it as having selected nothing and the first edit would
 * clear it.
 *
 * ## KEYED BY THE (COORDINATE, COMPONENT) PAIR SINCE 0569
 *
 * It was keyed by component alone, which is right for a Piece item and wrong for
 * a Set: TOP's ALL BODY and BOTTOM's ALL BODY are two panels, and withdrawing
 * the second because the first was ticked left half the garment with no cloth
 * and no way to ask for any (client 2026-09-17, Order #9). The returned shape is
 * a Map of component -> the coordinates claimed, read through `panelTaken`
 * below — never by looking inside it, which is where the wildcard would get
 * spelled a second way.
 */
export type TakenPanels = Map<string, Set<string>>;

export function takenPanels(
  entries: readonly {
    key: string;
    style_ref_no: string | null;
    panels: readonly ManualPanel[];
  }[],
  except: { key: string; style_ref_no: string | null },
): TakenPanels {
  const mine = styleKeyOf(except.style_ref_no);
  const out: TakenPanels = new Map();
  for (const e of entries) {
    if (e.key === except.key) continue;
    /* SCOPED TO THE STYLE (0495), and this is what the rule always wanted. 0494
       could only enforce it per DOCUMENT and said so uneasily: FRONT BODY of a
       tee and FRONT BODY of a polo are two panels wearing one master row, so a
       document-wide rule refuses a legitimate second style.

       AN UNSCOPED ENTRY COLLIDES WITH EVERYTHING, in both directions. `null`
       means "every style", so its panels are used on every style and every
       style's panels are used by it — which is the honest reading and the safe
       one: the alternative is an unscoped entry silently double-counting
       against a scoped one. */
    if (mine !== null && styleKeyOf(e.style_ref_no) !== null && styleKeyOf(e.style_ref_no) !== mine) {
      continue;
    }
    for (const p of e.panels) {
      const coords = out.get(p.component_id) ?? new Set<string>();
      coords.add(p.coordinate_id ?? "");
      out.set(p.component_id, coords);
    }
  }
  return out;
}

/**
 * IS THIS PANEL ALREADY SPOKEN FOR? — the membership half of the rule above,
 * kept beside it so the wildcard is stated once.
 *
 * "" IS THE UNSTATED COORDINATE and it collides BOTH WAYS (0569):
 *
 *   · a claim with no coordinate covers every coordinate of its component — a
 *     legacy entry planning ALL BODY is planning cloth for it whichever half of
 *     the Set it turns out to belong to, and letting TOP's ALL BODY be ticked
 *     beside it buys the panel twice;
 *   · a candidate with no coordinate is blocked by any claim on its component,
 *     for the same reason read from the other end.
 *
 * TOP AND BOTTOM DO NOT COLLIDE, which is the whole change: two coordinates of
 * one Set item are two panels, and the garment needs cloth for both.
 */
export function panelTaken(taken: TakenPanels, p: ManualPanel): boolean {
  const coords = taken.get(p.component_id);
  if (!coords) return false;
  if (coords.has("")) return true;
  if (p.coordinate_id === null) return true;
  return coords.has(p.coordinate_id);
}

/** Styles are keyed by VALUE throughout orders, so they are compared the way
 *  `styleKey` compares them — trimmed and case-folded. NULL stays NULL, because
 *  "every style" is a value and not a missing one. */
function styleKeyOf(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toUpperCase();
  return t === "" ? null : t;
}

/**
 * Whether one entry is answered, or the first thing missing.
 *
 * ONE SENTENCE PER PROBLEM, said the same way by the screen's Save gate, by the
 * overlay's Done button and by the stored requirement — the rule AGENTS.md
 * states for the duplicate check: "two spellings of one refusal is how an
 * operator comes to believe there are two different problems."
 *
 * ORDERED BY WHAT THE PLANNER FILLS FIRST — the fabric, then panels, then
 * weights (the fabric replaced the structure in 0522). A message naming the last blank on a row where the first is also
 * blank sends them to the wrong cell.
 *
 * `needed` is the set of sizes the ORDER states, which the caller derives from
 * `fabricSlices('colour_size', …)`. Passed in rather than computed here so this
 * module stays free of the production machinery, and so the screen and the
 * action share the explosion each has already run.
 */
export function manualProblem(
  entry: ManualEntryLike,
  needed: readonly { size_id: string | null; label: string }[],
  gsm: number | null | undefined,
): Refusal | null {
  /* THE FABRIC IS THE FIRST THING ASKED FOR SINCE 0522, because it is the first
     cell of legacy's row and because everything to its right — the knit type,
     the GSM, the measurement unit — is read off it. This used to ask for the
     STRUCTURE, which the planner no longer types. */
  if (!entry.item_id) {
    return { refused: "Choose the fabric this weight is for" };
  }
  if (entry.panels.length === 0) {
    return { refused: "Choose which components this weight covers" };
  }
  /* ASSORT COLOUR-WISE WITH NO COLOUR TICKED (0567) — asked here, between the
     panels and the weights, because that is the order the planner fills the row
     in: which cloth, which panels, which colours, how much.

     THE SAME SENTENCE `fabricSlices` REFUSES WITH. The engine cannot read an
     empty set as "every colourway" — that is precisely what switching the
     toggle OFF means — so without this the Save button would be live on a
     document the save then rejects, which is the two-spellings failure this
     function's own header names. */
  if (entry.assort_color_wise && (entry.combos ?? []).length === 0) {
    return {
      refused:
        "Assort Colour-Wise is on but no colourway is ticked — choose the colourways this weight is for, or switch Assort Colour-Wise off to use it for all of them",
    };
  }
  if (needed.length === 0) {
    return { refused: "This order states no sizes for this fabric" };
  }
  /* THE CALCULATED MODE'S OWN PRECONDITION, and it is named separately because
     the fix is on a different screen. Without a GSM the formula cannot produce a
     weight at all, so every size would report as blank and the planner would go
     looking at the size cells for a fault that is on the order. */
  if (calcModeOf(entry.calc_mode) === "calculated" && num(gsm) == null) {
    return {
      refused:
        "This fabric's structure states no single GSM on the order, so a weight cannot be calculated — enter it directly, or fix the GSM on the order",
    };
  }

  /* A ZERO CONS QTY BEFORE THE MISSING WEIGHTS: it is a typed value the save
     will reject outright, where a missing weight is only unfinished work.
     Named by size, capped at three, the same shape as the sentence below. */
  const zeroed = entry.sizes.filter((z) => z.size_id && consQtyRefused(z.cons_qty));
  if (zeroed.length > 0) {
    const labelOf = (id: string | null) => needed.find((n) => n.size_id === id)?.label ?? "a size";
    const names = zeroed.slice(0, 3).map((z) => labelOf(z.size_id)).join(", ");
    const more = zeroed.length > 3 ? ` and ${zeroed.length - 3} more` : "";
    return { refused: `${CONS_QTY_REFUSAL} (${names}${more})` };
  }

  const map = consumptionMap(entry.calc_mode, entry.sizes, gsm);
  const missing = needed.filter((n) => !n.size_id || map[n.size_id] === undefined);
  if (missing.length > 0) {
    /* NAME THE SIZES, capped at three. "Some sizes are missing" sends the
       planner down the grid counting blanks; three names and a count is the
       whole answer at a glance, with the empty cells beside it. */
    const names = missing.slice(0, 3).map((m) => m.label).join(", ");
    const more = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
    const what = calcModeOf(entry.calc_mode) === "calculated" ? "measurements" : "weight";
    return { refused: `Enter the ${what} for ${names}${more}` };
  }
  return null;
}

/**
 * WHICH ORDER COLOURWAYS NO ENTRY PLANS CLOTH FOR (0567).
 *
 * The client's spec asks for `⚠ Unassigned Combos: [CRANBERRY]` under the grid:
 * "if any defined order colorway is left unassigned ACROSS THE COMPONENT ROWS".
 *
 * ## IT IS PER COMPONENT, WHICH IS THE WHOLE DIFFICULTY
 *
 * "Is CRANBERRY covered?" has no answer at the document level. A BOM can plan
 * the front body in every colour and the neck rib in two of three — CRANBERRY
 * is then perfectly well covered for one panel and has no cloth at all for the
 * other, and a check that asked only "does any entry mention CRANBERRY?" would
 * answer yes and let a garment be planned with no rib.
 *
 * So a colourway is unassigned when ANY component that this BOM plans fails to
 * cover it. `manualProblem` already guarantees that a component appears with a
 * fabric and a weight; this is the other axis of the same completeness.
 *
 * ## AN ENTRY WITH THE TOGGLE OFF COVERS EVERYTHING
 *
 * Which is not a special case bolted on — it is the meaning of the toggle, and
 * the same reading `requirementRows` passes to `fabricSlices` (`combos` only
 * when `assort_color_wise`). One non-colour-wise entry for a panel is therefore
 * enough to cover that panel entirely, and this returns nothing for it.
 *
 * ## IT WARNS AND DOES NOT REFUSE
 *
 * Deliberately: a half-entered BOM is the ordinary state of a document being
 * typed, and a Save gate here would block the planner between their first row
 * and their last. The engine's refusals are for what cannot be COMPUTED; this
 * is for what has not been DECIDED, and the client asked for it as "a subtle
 * warning indicator" rather than a stop.
 *
 * Returns the unassigned colourways in the ORDER'S own order, which is the one
 * the operator reads them in elsewhere — never alphabetical, and never the
 * order the entries happen to be in.
 */
export function unassignedCombos(
  entries: readonly ManualEntryLike[],
  orderCombos: readonly string[],
): string[] {
  const wanted = orderCombos.filter((c) => (c ?? "").trim() !== "");
  if (wanted.length === 0) return [];

  /* PER PANEL: the colourways its entries between them cover. `null` is the
     "covers everything" marker — a panel with at least one entry whose toggle
     is off can never be short of a colour.

     KEYED BY THE PAIR SINCE 0569, like the allocation rule above. On a Set item
     TOP's ALL BODY and BOTTOM's ALL BODY are planned separately, so a colourway
     covered on one and missed on the other is exactly the gap this reports —
     keying by component alone would let the first hide the second. */
  const covered = new Map<string, Set<string> | null>();
  for (const e of entries) {
    // Scaffolding: a row naming no panel plans no cloth and is `manualProblem`'s
    // business, not this one's.
    if (e.panels.length === 0) continue;
    const all = !e.assort_color_wise;
    const mine = all ? null : new Set((e.combos ?? []).map((c) => comboKeyOf(c)));
    for (const panel of e.panels) {
      const id = panelKeyOf(panel);
      const held = covered.get(id);
      if (held === null) continue; // already covers everything
      if (mine === null) {
        covered.set(id, null);
        continue;
      }
      if (!held) covered.set(id, new Set(mine));
      else for (const c of mine) held.add(c);
    }
  }
  if (covered.size === 0) return [];

  return wanted.filter((c) => {
    const key = comboKeyOf(c);
    for (const set of covered.values()) {
      if (set !== null && !set.has(key)) return true;
    }
    return false;
  });
}

/** Colourways are compared the way every other reader of this document compares
 *  them — trimmed and case-folded. Same rule as `requirement.ts`'s `comboKey`,
 *  restated rather than imported for the reason this module states at the top:
 *  it stays free of the production machinery. */
function comboKeyOf(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}
