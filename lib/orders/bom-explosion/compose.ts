/**
 * Material BOM — PRODUCING the rows a grain asks for.
 *
 * `exploder.ts` says what a grain IS (a set of axes) and can name, store, dedupe
 * and key one. This module is the other half: given a grain, hand back the
 * `ProductionSlice[]` the requirement engine consumes.
 *
 * ## IT DELEGATES, AND THAT IS THE DESIGN RATHER THAN A SHORTCUT
 *
 * The obvious implementation is a general composer that walks the axes and
 * groups as it goes. It is the wrong one here, and the reason is written into
 * `primarySlices`: the `style` and `country` branches sit ABOVE the combo
 * checks **deliberately**, so a BOM split by style or destination is not refused
 * over a colourway rename it never reads. A generic walker loses that placement,
 * and the symptom is a refusal on a correct BOM — the failure mode that gets
 * believed rather than reported.
 *
 * So the eight grains the engine can already express are DELEGATED to
 * `productionSlices`, byte for byte. What is left is genuinely new work, and it
 * is written as a REFINEMENT of an existing grain rather than from scratch.
 *
 * ## THE TICK IS AN AXIS, WHICH IS WHY SO LITTLE IS LEFT
 *
 * Measured, not assumed (probe, 2026-08-23): the per-row "Size wise" tick adds
 * the `size` axis to whatever the basis already produces, so
 *
 *     order   + tick -> {size}                  style   + tick -> {style_ref, size}
 *     colour  + tick -> {style_ref, colour, size}   country + tick -> {size, country}
 *
 * `style + tick` is the client's #5 / #22 and needed no code at all. The two
 * documented equivalences (`order + tick` IS `size`, `colour + tick` IS
 * `combination`) fall out of the same fact.
 *
 * ## WHAT IS NOT HERE
 *
 * `trim_colour` is not an order axis and is deliberately absent: the Combination
 * sheet's panels are a property of the BOM LINE, and `colourSplits` (0436) applies
 * them to every slice downstream in `requirementRows`. Passing it here would be a
 * second place the trim colour divides rows.
 *
 * `pack` has no column on this schema; `axesAvailable` refuses it with a sentence
 * before anything is computed.
 */

import {
  apportion,
  comboKey,
  isRefusal as isEngineRefusal,
  productionSlices,
  SLICE_SEP,
  type OrderProductionInput,
  type ProductionSlice,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  axesAvailable,
  canonicalAxes,
  isRefusal,
  labelFor,
  serializeAxes,
  type Axis,
  type Refusal,
} from "@/lib/orders/bom-explosion/exploder";

/**
 * The axes an ORDER can be split by. `trim_colour` and `pack` are excluded for
 * the two different reasons the header gives — one belongs to the BOM line, the
 * other has no column — and excluding them here is what lets a caller pass a
 * full grain without having to strip it first.
 */
export const ORDER_AXES = ["style_ref", "colour", "size", "country"] as const satisfies
  readonly Axis[];

export function orderAxesOf(axes: readonly Axis[]): Axis[] {
  const want = new Set(canonicalAxes(axes));
  return (ORDER_AXES as readonly Axis[]).filter((a) => want.has(a));
}

/**
 * THE EIGHT GRAINS THE ENGINE ALREADY PRODUCES, and how to ask for each.
 *
 * Every one of these was verified against the real engine before being written
 * down — `check-bom-explosion.mts` re-runs that check, asserting that the rows a
 * plan produces are partitioned 1:1 by the grain it claims. A table like this is
 * worth exactly as much as the assertion behind it.
 */
const PLANS: { axes: Axis[]; basis: RequirementBasis; tick: boolean }[] = [
  { axes: [], basis: "order", tick: false },
  { axes: ["size"], basis: "size", tick: false },
  { axes: ["style_ref"], basis: "style", tick: false },
  { axes: ["style_ref", "size"], basis: "style", tick: true },
  { axes: ["style_ref", "colour"], basis: "colour", tick: false },
  { axes: ["style_ref", "colour", "size"], basis: "combination", tick: false },
  { axes: ["country"], basis: "country", tick: false },
  { axes: ["size", "country"], basis: "country", tick: true },
];

/** The grain this module composes rather than delegates — the client's #16. */
const COUNTRY_MATRIX = serializeAxes(["style_ref", "colour", "size", "country"]);

/**
 * Why a grain that is neither delegated nor composed cannot be produced.
 *
 * NAMED, NEVER A SILENT FALLBACK TO SOMETHING COARSER. A grain the operator
 * asked for that quietly resolves one axis short produces fewer rows and a
 * total that looks entirely correct — the partial-explosion failure
 * `requirement.ts` opens its header with, arriving through the one door that is
 * supposed to be a convenience.
 */
function whyUnreachable(axes: readonly Axis[]): string {
  const key = serializeAxes(axes);
  /*
   * {colour} ALONE IS NOT AN OVERSIGHT — the engine argues against it.
   *
   * `primarySlices`' colour branch keys on (style, combo) and its comment says
   * why: "WHITE can exist under two styles with different targets, and
   * collapsing them would let one style's white absorb the other's." The
   * client's #26 (`Combination / Order Color`) asks for exactly that collapse,
   * to consolidate one cone of red thread across the order — a defensible
   * purchase decision and a reversal of a stated rule, so it needs a decision
   * rather than an implementation.
   */
  if (key === serializeAxes(["colour"])) {
    return "Colour across every style is not a split this engine makes — a colourway belongs to a style (see #26)";
  }
  return `${labelFor(axes)} is not a split this order can be exploded by yet`;
}

/**
 * The rows a grain produces, or a refusal carrying the sentence the screen prints.
 *
 * NEVER THROWS. The spec this came from parsed a label and threw on an
 * unrecognised token; a throw here takes the screen down, where a refusal prints
 * in one cell and names what to go and fix.
 */
export function slicesForAxes(
  axes: readonly Axis[],
  order: OrderProductionInput,
  rule?: Parameters<typeof productionSlices>[2],
): ProductionSlice[] | Refusal {
  // The unavailable axes are refused BEFORE any work, so `pack` cannot reach a
  // plan lookup and silently miss it — a missing axis and an unsupported grain
  // are different sentences.
  const ok = axesAvailable(axes);
  if (isRefusal(ok)) return ok;

  const want = orderAxesOf(axes);
  const key = serializeAxes(want);

  const plan = PLANS.find((p) => serializeAxes(p.axes) === key);
  if (plan) {
    /* DELEGATED, WITH THE TICK ON EVERY ROW. `sizeWise` is a predicate per
       primary row because legacy ticks rows individually; a whole-grain request
       means every row, which is the equivalence the engine already asserts
       ("Order + every row ticked IS the old size basis"). */
    return productionSlices(plan.basis, order, rule, plan.tick ? () => true : undefined);
  }

  if (key === COUNTRY_MATRIX) {
    const base = productionSlices("combination", order, rule);
    if (isEngineRefusal(base)) return base;
    return refineByCountry(base, order);
  }

  return { refused: whyUnreachable(want) };
}

/**
 * Split each slice across the destinations ITS OWN garments ship to.
 *
 * ## A REFINEMENT, NOT A SECOND EXPLOSION
 *
 * The rows arrive already correct at {style_ref, colour, size} and summing to
 * the order total; this divides each one and the parts sum back to it, through
 * the SAME `apportion` every other split uses. Re-deriving the matrix here to
 * add one axis would be a second answer to "what is this order's size curve",
 * and the two would agree only until one was edited.
 *
 * ## A DESTINATION THAT THIS SLICE DOES NOT SHIP TO IS NOT AN ERROR
 *
 * `primarySlices`' country branch refuses when a destination on the order has no
 * quantity, because there it is dividing the WHOLE order and a missing one means
 * the split is short. Here the question is narrower — which destinations does
 * *this size of this colourway* go to — and "only the USA" is an ordinary
 * answer. So a slice is refused only when it can be matched to no assort row at
 * all, which is the case where the division would be invented rather than read.
 */
function refineByCountry(
  slices: readonly ProductionSlice[],
  order: OrderProductionInput,
): ProductionSlice[] | Refusal {
  const out: ProductionSlice[] = [];

  for (const sl of slices) {
    const rows = order.assortSizes.filter(
      (r) =>
        styleKey(r.style_ref_no) === styleKey(sl.style_ref_no) &&
        comboKey(r.combo) === comboKey(sl.combo) &&
        r.size_id === sl.size_id,
    );
    if (rows.length === 0) {
      return { refused: `No destination on Quantities for ${sl.label}` };
    }

    /* FIRST-APPEARANCE ORDER, so the rows read down the screen in the order the
       operator entered their destinations — the same choice the country branch
       makes. A NULL destination is a real bucket ("(no destination)"), not a row
       to skip: dropping it would lose its quantity and shorten the total. */
    const byCountry = new Map<string, number>();
    for (const r of rows) {
      const id = r.country_id ?? "";
      const q = typeof r.qty === "number" && Number.isFinite(r.qty) ? r.qty : 0;
      byCountry.set(id, (byCountry.get(id) ?? 0) + q);
    }

    const ids = [...byCountry.keys()];
    const weights = ids.map((id) => byCountry.get(id) ?? 0);
    if (weights.every((w) => w <= 0)) {
      return { refused: `Size break-up has no quantities for ${sl.label}` };
    }

    const shares = apportion(sl.qty, weights);
    ids.forEach((id, i) => {
      const name = id ? (order.countryNames?.[id] ?? id) : "(no destination)";
      out.push({
        /* THE SAME KEY SCHEME `expandBySize` MINTS, so a child stays findable by
           `key.startsWith(parent.key + SLICE_SEP)` — the grouping the screen
           does is a string test, and a second scheme here would break it. */
        key: `${sl.key}${SLICE_SEP}${id}`,
        label: `${sl.label} · ${name}`,
        qty: shares[i],
        style_ref_no: sl.style_ref_no,
        combo: sl.combo,
        size_id: sl.size_id,
        country_id: id || null,
      });
    });
  }

  return out;
}

/**
 * Every grain this module can produce today, for a screen that has to offer them.
 *
 * DERIVED FROM THE PLANS, never a second list — a menu hand-maintained beside the
 * thing it describes is how `lib/reports/catalog.ts` records its own worst bug,
 * and how the nav list and the landing grid fell out of sync before that.
 */
export function producibleGrains(): Axis[][] {
  return [...PLANS.map((p) => p.axes), ["style_ref", "colour", "size", "country"] as Axis[]];
}
