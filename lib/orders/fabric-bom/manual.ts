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

/** One size row of one entry, as much of it as the arithmetic needs. */
export type ManualSizeInput = {
  /** `config_lookups` id. NULL is a size the order no longer states. */
  size_id: string | null;
  /** The knitting / finishing diameter — 60 Dia, 52 Dia, 28 Dia. */
  dia: number | null;
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
  length_tolerance: number | null;
};

/**
 * The metric conversion in the calculated-mode weight, isolated on purpose.
 *
 * PROVISIONAL, AND THE CLIENT SAID SO: "the exact conversion constants for this
 * formula will be adjusted and verified in a later discussion". It sits here, as
 * one named constant read by exactly one expression, so that adjustment is a
 * one-line change with a vector beside it rather than a hunt through the screen,
 * the action and the sheet.
 *
 * cm x cm is cm²; /10,000 makes it m²; x gsm (g/m²) makes it grams. 10,000 is
 * what the client states as typical, and the arithmetic agrees with it — which
 * is why it is a named default and not a question left open in the code.
 */
export const GRAMS_CONVERSION = 10_000;

// ---------------------------------------------------------------------------
// The calculated mode
// ---------------------------------------------------------------------------

/**
 * Length after the cutting tolerance.
 *
 *     effective = length + tolerance
 *
 * ADDED, NOT SCALED. Legacy's grid puts Length, Length Tolerance and a second
 * Length side by side in one row of the same units, and a tolerance beside a
 * measurement in the same unit is an allowance in that unit — a sewing allowance
 * is "2 cm", never "2%". The percentage reading compiles and is wrong by a
 * factor of the length, which is largest on exactly the sizes that cost most.
 *
 * NULL WHEN THERE IS NO LENGTH. A tolerance on its own is not a length, and
 * returning the tolerance would print a plausible small number in the column the
 * operator reads as the panel.
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
 * The panel weight this size implies, in GRAMS per garment.
 *
 *     g = tableWidth(cm) x effectiveLength(cm) x gsm(g/m2) / GRAMS_CONVERSION
 *
 * ## THERE IS NO x2, AND THERE USED TO BE
 *
 * The first cut doubled this for "front and back panel", on the standard
 * knitwear body calculation. The client's field-by-field spec states the formula
 * without it — `TableWidth` is the panel width the planner types, and the
 * planner types one row per panel group rather than one per garment half. The
 * doubling was also wrong on its own terms for anything that is not a body: a
 * neck rib is ONE panel, and its weight came out twice what it should be.
 *
 * So the multiplicity now lives where the planner controls it — in which
 * components an entry covers and what width they type for them — rather than in
 * a constant this module assumed on their behalf.
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
  const g = num(gsm);
  const l = effectiveLength(row.length, row.length_tolerance);
  if (w == null || l == null || g == null) return null;
  if (w <= 0 || l <= 0 || g <= 0) return null;
  return (w * l * g) / GRAMS_CONVERSION;
}

/**
 * The gram weight this size row states, whichever mode produced it.
 *
 * ONE FUNCTION, READ BY EVERYTHING. The screen prints it, `consumptionMap` feeds
 * it to the engine, and the save writes it — so a direct entry and a calculated
 * entry are indistinguishable to every reader downstream, which is the whole
 * reason `grams` is a stored column rather than a mode-dependent derivation.
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
 * Formula 1 — Net Fabric Required (Kg) = Order Quantity x grams / 1000.
 *
 * The client's worked example: 10,510 pcs x 50 g = 525.5 Kg.
 *
 * FOR DISPLAY. The stored requirement goes through `fabricRequirementRows`,
 * which multiplies `slice.qty x (grams/1000) x (1 + wastage/100)` and rounds UP
 * at the consumption UOM's own precision. This is the same arithmetic without
 * the ceiling, so the screen and the database agree to within that rounding and
 * never by a second formula. See the module header.
 */
export function netKg(orderQty: number | null, grams: number | null): number | null {
  const q = num(orderQty);
  const g = num(grams);
  if (q == null || g == null) return null;
  return (q * g) / 1000;
}

/** Formula 2 — Gross Fabric Required (Kg) = Net x (1 + wastage% / 100). */
export function grossKg(net: number | null, wastagePct: number | null): number | null {
  const n = num(net);
  if (n == null) return null;
  const w = num(wastagePct) ?? 0;
  if (w < 0 || w > 100) return null;
  return n * (1 + w / 100);
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
    out[r.size_id] = g / 1000;
  }
  return out;
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
  component_ids: readonly string[];
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
 */
export function takenComponentIds(
  entries: readonly {
    key: string;
    style_ref_no: string | null;
    component_ids: readonly string[];
  }[],
  except: { key: string; style_ref_no: string | null },
): Set<string> {
  const mine = styleKeyOf(except.style_ref_no);
  const out = new Set<string>();
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
    for (const id of e.component_ids) out.add(id);
  }
  return out;
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
  if (entry.component_ids.length === 0) {
    return { refused: "Choose which components this weight covers" };
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
