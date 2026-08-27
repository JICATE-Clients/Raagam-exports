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
  groupKeyFor,
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

/** Every order axis at once — the finest thing this module can produce, and the
 *  source a coarsened grain falls back to when its own +style twin has no plan. */
const FULL_MATRIX: Axis[] = ["style_ref", "colour", "size", "country"];

/**
 * COLOUR WITHOUT STYLE — the client's #3, #4, #15 and #17, served since
 * 2026-08-27 ("i need to make sure every attribute is working").
 *
 * ## THIS REVERSES A STATED RULE, DELIBERATELY, AND ONLY FOR THE PURCHASE
 *
 * `primarySlices`' colour branch keys on (style, combo) because "WHITE can exist
 * under two styles with different targets, and collapsing them would let one
 * style's white absorb the other's". That is true of a PRODUCTION target and it
 * is why these four rows refused for months. It is NOT true of a purchase: the
 * red thread bought for two styles is one cone, and consolidating it is the
 * whole point the client's #26 was asking for.
 *
 * Nothing is absorbed here because nothing is replaced — the groups are SUMMED.
 * A style's white contributes its own quantity and keeps it; what changes is
 * that both contributions are bought on one line instead of two.
 *
 * ## SO THE SINGLE-STYLE PATH BELOW IS STILL SEPARATE, AND STAYS
 *
 * A one-style order is already answered by WIDENING (see `slicesForAxes`), which
 * re-asks the ordinary plan with `style_ref` added and therefore produces the
 * engine's own rows, labels and slice KEYS. Those keys are what per-slice
 * overrides are stored against, so routing a single-style order through the
 * coarsener instead would silently re-key every override an operator has typed.
 * The two paths agree on every figure — asserted in `check-bom-explosion` — and
 * differ only in a label and a key, which is exactly the difference that must
 * not move under stored data.
 */
const COARSENED: Axis[][] = [
  ["colour"],
  ["colour", "size"],
  ["colour", "country"],
  ["colour", "size", "country"],
];

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
  /* THE {colour}-ALONE BRANCH THAT STOOD HERE IS GONE (2026-08-27). It said
     "Colour across every style is not a split this engine makes", which was the
     client's #26 awaiting a decision; the decision was taken and `COARSENED`
     serves it. Recorded rather than silently deleted, because the ARGUMENT it
     carried is still correct about production targets and is preserved in
     `COARSENED`'s header — what changed is that a purchase sums where a target
     would have absorbed. */
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

  /**
   * A COLOUR GRAIN ON A SINGLE-STYLE ORDER IS NOT AMBIGUOUS, so it is not refused
   * (client 2026-08-27, screenshot 2510: "Order No / Order Color / Order Size is
   * not a split this order can be exploded by yet" on an ordinary BOM).
   *
   * The block it lifts is real and stays: `colour_needs_style` in
   * `client-matrix.ts` refuses the client's #3 and #4 because "the same white
   * under two styles is two different requirements", and `primarySlices`' colour
   * branch keys on (style, combo) for that reason. Collapsing WHITE across two
   * styles would let one style's white absorb the other's.
   *
   * BUT THAT ARGUMENT NEEDS TWO STYLES TO BE TRUE. On an order carrying one,
   * {colour} and {style_ref, colour} partition the same rows into the same
   * groups — there is no second white to absorb anything. The refusal was
   * answering a question about the GRAIN when the hazard is a property of the
   * ORDER, and most garment orders have a single style, so the commonest case
   * was refused to protect the rarer one.
   *
   * WIDENED, NOT SPECIAL-CASED. It re-asks with `style_ref` added and lets the
   * ordinary plan lookup answer, so {colour} becomes the `colour` basis and
   * {colour, size} becomes `combination` — the rows, the apportioning and the
   * rejection tiers are the ones every other grain already goes through, not a
   * second implementation that could drift. The recursion is one level deep by
   * construction: the widened grain carries `style_ref`, so it cannot come back
   * here.
   *
   * WHAT IS STORED IS STILL WHAT THE OPERATOR CHOSE. Only the production is
   * widened; the BOM records the grain that was picked, which is the distinction
   * `client-matrix.ts` already draws between what a grain RECORDS and what the
   * explosion does.
   *
   * A MULTI-STYLE ORDER IS STILL REFUSED, with the same sentence as before —
   * that is the client's #26 and it needs a decision, not an implementation.
   */
  if (want.includes("colour") && !want.includes("style_ref") && soleStyleOf(order)) {
    return slicesForAxes(canonicalAxes([...want, "style_ref"]), order, rule);
  }

  /*
   * THE SAME GRAIN ON A MULTI-STYLE ORDER — coarsened, not refused (client
   * 2026-08-27). See `COARSENED` above for why summing is right for a purchase
   * where absorbing would be wrong for a target.
   *
   * THE SOURCE IS THE FINEST GRAIN THAT COVERS THIS ONE, and it is asked for
   * through `slicesForAxes` rather than built here, so the rows being summed
   * have been through the same plans, apportioning and rejection tiers as every
   * other grain. `+style_ref` is the natural source; where that has no plan
   * ({colour, country} does not), the full matrix stands in and the extra axis
   * is summed away by the same grouping.
   */
  if (COARSENED.some((g) => serializeAxes(g) === key)) {
    const widened = canonicalAxes([...want, "style_ref"]);
    const source = PLANS.some((p) => serializeAxes(p.axes) === serializeAxes(widened))
      ? widened
      : FULL_MATRIX;
    const base = slicesForAxes(source, order, rule);
    if (isRefusal(base)) return base;
    return coarsenTo(want, base, order);
  }

  return { refused: whyUnreachable(want) };
}

/**
 * The same rows, regrouped onto a grain that drops an axis they carry.
 *
 * ## SUMMED, NEVER RE-DERIVED
 *
 * The parts arrive already correct and already summing to the order total, so
 * grouping and adding preserves that exactly — the same argument `refineByCountry`
 * makes in the other direction. Re-deriving the matrix at the coarser grain would
 * be a second answer to "what is this order's colour split", and the two would
 * agree only until one was edited.
 *
 * ## THE KEY IS THE GROUP'S OWN IDENTITY
 *
 * `groupKeyFor` is what `rowCountFor` already counts by, so a coarsened row is
 * keyed by exactly the thing that makes it one row. It cannot collide with a
 * finer grain's key because it names its axes in it.
 *
 * ## A DROPPED AXIS IS NULLED, NOT LEFT ON THE FIRST MEMBER
 *
 * The representative slice carries a value only on the axes the grain actually
 * names. Keeping `style_ref_no` from whichever member happened to sort first
 * would put one style's name on a row covering several — a label that reads as
 * provenance and is a lie.
 */
function coarsenTo(
  wanted: readonly Axis[],
  slices: readonly ProductionSlice[],
  order: OrderProductionInput,
): ProductionSlice[] {
  const want = new Set(canonicalAxes(wanted));
  const groups = new Map<string, ProductionSlice[]>();
  for (const sl of slices) {
    const k = groupKeyFor(wanted, sl);
    const at = groups.get(k);
    if (at) at.push(sl);
    else groups.set(k, [sl]);
  }
  return [...groups].map(([key, members]) => {
    const first = members[0]!;
    const parts: string[] = [];
    if (want.has("style_ref")) parts.push(first.style_ref_no ?? "(no style)");
    if (want.has("colour")) parts.push(first.combo ?? "(no colour)");
    if (want.has("size")) {
      parts.push(
        first.size_id ? (order.sizeNames?.[first.size_id] ?? first.size_id) : "(no size)",
      );
    }
    if (want.has("country")) {
      parts.push(
        first.country_id
          ? (order.countryNames?.[first.country_id] ?? first.country_id)
          : "(no destination)",
      );
    }
    return {
      key,
      label: parts.join(" · ") || "Whole order",
      qty: members.reduce((t, m) => t + m.qty, 0),
      style_ref_no: want.has("style_ref") ? first.style_ref_no : null,
      combo: want.has("colour") ? first.combo : null,
      size_id: want.has("size") ? first.size_id : null,
      country_id: want.has("country") ? (first.country_id ?? null) : null,
    };
  });
}

/**
 * The one style this order is for, or null when it carries none or several.
 *
 * Read off `approvals` because that is the list the explosion itself divides —
 * asking a different source (the order header's Multi Style switch, the styles
 * grid) could say "one style" about rows that carry two, and the guard would
 * then be lifted over exactly the data it exists to protect.
 */
function soleStyleOf(order: OrderProductionInput): string | null {
  const keys = new Set(order.approvals.map((a) => styleKey(a.style_ref_no)));
  return keys.size === 1 ? [...keys][0]! : null;
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
  return [
    ...PLANS.map((p) => p.axes),
    FULL_MATRIX,
    /* THE FOUR COARSENED COLOUR GRAINS. Offered like any other: a grain this
       module can produce is a grain the screen may show, and the vectors assert
       the two lists are the same set in both directions. */
    ...COARSENED,
  ];
}
