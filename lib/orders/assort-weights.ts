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
  /**
   * WHAT THE SIZE RATIO DESCRIBES — 0414's tuple, `'master' | 'inner'`.
   *
   * On an assorted pack the size cells are a ratio, and this says which BOX
   * that ratio fills. It is the difference between two orders that look
   * identical on screen — see `ratioScope`.
   */
  ratio_for?: string | null;
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
 * WHICH BOX THE SIZE RATIO FILLS — the client's "Ratio for Inner or Master?".
 *
 *   master  the ratio IS the shipping carton. No sub-bundles exist inside it,
 *           so there is nothing for `inners_per_carton` to count and it takes
 *           no part in the arithmetic.
 *   inner   the ratio is one poly bag; several poly bags fill a master carton.
 *
 *     master  pieces = cartons x ratio
 *     inner   pieces = cartons x inners x ratio
 *
 * ## WHY THIS FUNCTION EXISTS
 *
 * `ratio_for` has had a column since 0414, a CHECK constraint restricting it to
 * this tuple, and a Select in the Assortments overlay. Until now NOTHING read
 * it. Both engines multiplied by inners unconditionally, which is the `inner`
 * branch — so an order declared `master` was computed as though it were
 * `inner`, and the declaration the operator made was decoration.
 *
 * IT HID BECAUSE `inners_per_carton` IS 1 ON EVERY ROW IN THE DATABASE TODAY,
 * exactly as the file's own header records the previous version of this bug
 * hiding. The first `master` pack with 10 inners typed would have bought ten
 * times the cloth, and nothing would have said so: the total is plausible, the
 * breakup balances against a PO Qty computed by the same wrong factor, and the
 * failure only becomes visible in a warehouse.
 *
 * BLANK READS AS `master`, which is the SAFE direction and matches what the
 * screen already computes for a blank (`innersOf` returns 1, so the inners drop
 * out). It is deliberately not a guess in the other direction: reading a blank
 * as `inner` would multiply by a number nobody has confirmed the meaning of.
 * The screen blocks Save on a blank, so a stored blank is a row from before
 * that rule.
 */
export function ratioScope(q: AssortQuantity): "master" | "inner" {
  return (q.ratio_for ?? "").trim().toLowerCase() === "inner" ? "inner" : "master";
}

/**
 * The pieces one unit of ratio is worth on an assorted line.
 *
 * `|| 1` ON INNERS, NEVER `|| 0`, and that was the second bug in this file: it
 * read a blank as ZERO, so a line whose `inners_per_carton` arrived NULL weighed
 * NOTHING for the Material BOM and the budget while the screen beside it read
 * the same blank as one. The column defaults to 1 (0432) and the screen's
 * payload writes `?? 1`, so it needed a row from any other path to fire — a
 * data-io import, a hand-written insert, a row older than the column. "A blank
 * multiplier means one, not none" is the screen's wording for the same rule;
 * this is where the two stopped saying it differently.
 *
 * Cartons stays `|| 0`: it is a COUNT, not a multiplier, and an assorted pack
 * with no carton count entered genuinely ships nothing yet.
 */
export function packFactor(
  l: { no_of_cartons: number | null; inners_per_carton?: number | null },
  scope: "master" | "inner",
): number {
  const cartons = Number(l.no_of_cartons) || 0;
  return scope === "inner" ? cartons * (Number(l.inners_per_carton) || 1) : cartons;
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
    /* Resolved ONCE per destination, like the mode above it: `ratio_for` is a
       property of the row, and re-reading it per line is how two lines of one
       carton would come to disagree about what a carton is. */
    const scope = ratioScope(q);
    return (q.assort_lines ?? []).flatMap((l) => {
      // The multiplier is the ONLY thing the mode changes — kept as one
      // expression so the two branches cannot drift into reading the row
      // differently.
      const factor = mode === "solid" ? 1 : packFactor(l, scope);
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
  "style_ref_no,country_id,assortment_type_id,ratio_for," +
  // `ratio_for` IS THE SECOND HALF OF THE ARITHMETIC and was the second
  // column this select forgot, after `assort_lines.style_ref_no`. Without it
  // `ratioScope` reads every destination as `master` and an Inner-ratio pack
  // is under-counted by its inners — the same shape of failure, one column
  // along: the code reads as correct and the value never arrives.
  "assortment_type:config_lookups!garment_order_amendment_quantities_assortment_type_id_fkey(code,name)," +
  // `style_ref_no` FIRST on the line, and it is the half that was missing: the
  // column has existed since 0433 and nothing selected it, so the coalesce above
  // had nothing to prefer.
  "assort_lines:garment_order_amendment_assort_lines(style_ref_no,combo,no_of_cartons,inners_per_carton," +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty))";
