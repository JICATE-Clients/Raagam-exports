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
  /** The declared Assortment Type. `null` reads as Solid — see `assortMode`. */
  assortment_type?: { code: string | null; name: string | null } | null;
  assort_lines?:
    | {
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
 * THE STYLE IS THE DESTINATION'S, not the line's. On a Single Style pack the
 * line stores no ref at all and takes the destination's — which is why reading
 * `assort_lines.style_ref_no` raw yields null and pairs with nothing.
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
        style_ref_no: q.style_ref_no,
        combo: l.combo,
        size_id: z.size_id,
        qty: factor * (Number(z.qty) || 0),
      }));
    });
  });
}

/** The PostgREST fragment a caller must select to be able to answer this. */
export const ASSORT_WEIGHT_SELECT =
  "style_ref_no,assortment_type_id," +
  "assortment_type:config_lookups!garment_order_amendment_quantities_assortment_type_id_fkey(code,name)," +
  "assort_lines:garment_order_amendment_assort_lines(combo,no_of_cartons,inners_per_carton," +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty))";
