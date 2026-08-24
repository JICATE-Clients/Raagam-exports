/**
 * WHAT A SIZE CELL ON THE ASSORT TREE IS WORTH, in one place.
 *
 * The Quantities ▸ Assort tree stores a number per (destination, line, size),
 * and what that number MEANS depends on the destination's Assortment Type:
 *
 *   Solid / Solid   → the cell IS the pieces. There is no carton count, because
 *                     on a solid pack it is unknowable, so the column sits at 0.
 *   Solid / Assort  → the cell is a RATIO, and the pieces are
 *                     cartons x inners x ratio.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Three callers read that tree — the Garment Order screen's `pricingWeights`,
 * `orderProductionInput` for the Material BOMs, and the budget's sales value —
 * and each carried its own copy of the multiplication. The comment above each
 * copy said the expression was "copied deliberately" so the three could not
 * disagree. They disagreed anyway: two of them multiplied by `no_of_cartons`
 * unconditionally, which on a Solid/Solid order is a multiplication by ZERO.
 *
 * The Material BOM refused every line with "Size break-up has no quantities for
 * WHITE" while the break-up was entered and summing to exactly the approval
 * quantity (found 2026-08-20, on a live order). The budget put the same order's
 * sales value at nothing. Both read a correct order wrongly, and neither said so
 * — a zero is indistinguishable from an order nobody has filled in yet.
 *
 * So the rule is a FUNCTION now rather than a comment asking three files to stay
 * in step. A copy is not a shared rule; this is.
 *
 * ## THE SECOND BUG THE COPIES CARRIED
 *
 * Both dropped `inners_per_carton`, so an assort pack was under-counted by that
 * factor. It hides wherever inners is 1 — which is every order in the database
 * today — and would have surfaced as a quietly short purchase, not as an error.
 */

/** One destination of the Quantities tab, as much of it as the weight needs. */
export type AssortQuantity = {
  style_ref_no: string | null;
  /** The destination this row ships to (0398). Read by the Material BOM's
   *  country-wise basis; every other caller ignores it. */
  country_id?: string | null;
  /** The declared Assortment Type. `null` reads as Solid — see `assortMode`. */
  assortment_type?: { code: string | null; name: string | null } | null;
  assort_lines?:
    | {
        /**
         * THE LINE'S OWN STYLE (0433, Multiple Style — a style per LINE).
         *
         * Optional because a Single Style pack leaves it null and the
         * destination's ref is the answer there. Declared here at all because
         * without it this type could not express the multi-style case, and the
         * select below could not ask for it — which is exactly the state it was
         * in until 2026-08-23.
         */
        style_ref_no?: string | null;
        combo: string | null;
        no_of_cartons: number | null;
        inners_per_carton?: number | null;
        sizes?: { size_id: string | null; qty: number | null }[] | null;
      }[]
    | null;
};

/** One (style, combo, size) and the pieces it is worth. */
export type SizeWeight = {
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  qty: number;
  /** Carried through from the destination row, so a caller splitting by country
   *  has something to group on. THE DATA HALF: without it the country basis
   *  compiles, runs and groups everything under one blank destination. */
  country_id?: string | null;
};

/**
 * Solid or assort, off the DECLARED type — never inferred from the data.
 *
 * A zero carton count is also what an assort pack looks like before anybody has
 * typed one, so inferring the mode from it would silently switch the arithmetic
 * underneath a half-filled row. This is the same reading `assortModeOf` makes on
 * the order screen: the lookup's `code` where it has one, and its NAME only as
 * the fallback for rows that predate 0400 seeding the codes.
 *
 * AN UNSET TYPE READS AS SOLID, which is the safe direction: it counts the cell
 * at face value rather than multiplying it by a carton count nobody has entered.
 * The order screen refuses to open the Assort overlay until a type is chosen
 * (`assortGateFor`), so an unset type here is a row from before that gate.
 */
export function assortMode(q: AssortQuantity): "solid" | "assort" {
  const code = q.assortment_type?.code ?? null;
  if (code) return code === "solid_solid" ? "solid" : "assort";
  return /assort\s*size/i.test(q.assortment_type?.name ?? "") ? "assort" : "solid";
}

/**
 * Every size cell of every destination, in pieces.
 *
 * ## THE STYLE IS THE LINE'S, FALLING BACK TO THE DESTINATION'S
 *
 * This read `q.style_ref_no` alone, and the comment here justified it: "on a
 * Single Style pack the line stores no ref at all and takes the destination's —
 * which is why reading `assort_lines.style_ref_no` raw yields null and pairs
 * with nothing." That was TRUE and became HALF true, twice over:
 *
 *  - 0433 made Multiple Style real, and a multi-style pack carries the ref on
 *    the LINE. Reading the destination's there attributes every size cell of
 *    every style to whatever the destination row happens to hold.
 *  - The client made `quantities.style_ref_no` FREE TEXT on 2026-08-17. So what
 *    the destination holds is now often not a style ref at all.
 *
 * Measured on the live database, 2026-08-23 — neither column is right alone:
 *
 *     quantities_ref        assort_line_ref     which is correct
 *     111 / 123 / 12        STL/26-27/0007…     the LINE
 *     STL/26-27/0003        null                the DESTINATION
 *
 * What it cost: `productionSlices`' size and combination branches match assort
 * rows to targets by style, so a mismatch matched NOTHING and the whole basis
 * refused — with a sentence blaming the wrong tab ("Size break-up not entered on
 * Quantities ▸ Assort") on 3 of 4 live orders. Safe, because this module refuses
 * rather than inventing a number, and useless, because the break-up WAS entered.
 *
 * `??` and not `||`: an empty-string ref is a value somebody typed, and falling
 * through it to the destination would silently re-attribute the line.
 *
 * THE SELECT HAD TO CHANGE WITH IT. `ASSORT_WEIGHT_SELECT` never asked for the
 * line's ref, so the column existed, the code read as correct, and the value
 * never arrived — the same two-halves failure AGENTS.md records under
 * "Created Date / Created User", where the column half passing said nothing
 * about whether the value came back.
 *
 * ROWS ARE NOT FILTERED OR SUMMED HERE. A caller that wants a total sums them; a
 * caller that wants the size curve needs each cell. Collapsing early is how the
 * two callers would start needing two functions again.
 */
export function assortSizeWeights(
  quantities: readonly AssortQuantity[] | null | undefined,
): SizeWeight[] {
  return (quantities ?? []).flatMap((q) => {
    const mode = assortMode(q);
    return (q.assort_lines ?? []).flatMap((l) => {
      const cartons = Number(l.no_of_cartons) || 0;
      const inners = Number(l.inners_per_carton) || 0;
      // The multiplier is the ONLY thing the mode changes — kept as one
      // expression so the two branches cannot drift into reading the row
      // differently.
      const factor = mode === "solid" ? 1 : cartons * inners;
      return (l.sizes ?? []).map((z) => ({
        style_ref_no: l.style_ref_no ?? q.style_ref_no,
        combo: l.combo,
        size_id: z.size_id,
        qty: factor * (Number(z.qty) || 0),
        // The DESTINATION's, like the style above it — an assort line belongs to
        // the quantity row it hangs off, and that row is one destination.
        country_id: q.country_id ?? null,
      }));
    });
  });
}

/** The PostgREST fragment a caller must select to be able to answer this. */
export const ASSORT_WEIGHT_SELECT =
  "style_ref_no,country_id,assortment_type_id," +
  "assortment_type:config_lookups!garment_order_amendment_quantities_assortment_type_id_fkey(code,name)," +
  // `style_ref_no` FIRST on the line, and it is the half that was missing: the
  // column has existed since 0433 and nothing selected it, so the coalesce above
  // had nothing to prefer.
  "assort_lines:garment_order_amendment_assort_lines(style_ref_no,combo,no_of_cartons,inners_per_carton," +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty))";
