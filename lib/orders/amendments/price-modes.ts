/**
 * CHANGING PRICE TYPE CARRIES THE RATES WITH IT (client 2026-08-21, screenshot
 * 2446: "why showing this warning, user just updated that type … automatically
 * update user last select type, that enough").
 *
 * ## What this replaces
 *
 * Switching mode used to LEAVE the old rates where they were. They kept their
 * previous `price_type`, dropped out of the grid, were still saved, and still
 * blocked `orderValue` — so the tab printed an amber block telling the operator
 * to set Price Type BACK to the mode they had just moved off. An instruction to
 * undo the thing you just did is not a warning, it is a refusal.
 *
 * ## The rule
 *
 * A rate the operator has already typed is an ANSWER, and an answer keeps
 * applying as far as it unambiguously can. A blank axis means "all of them":
 *
 *   Size-wise -> Color-wise Size-wise   S = 4  becomes  every colour's S = 4
 *   Color-wise -> Color-wise Size-wise  WHITE = 5.20 becomes WHITE's every size
 *   Style-wise -> anything              the one rate fills every cell
 *
 * Those three are WIDENING and are lossless: one source covers each new cell.
 *
 * NARROWING IS THE HARD DIRECTION and is where this earns its vectors. Going
 * from Color-wise Size-wise back to Color-wise, WHITE's seven size rates
 * collapse into one cell. If they all read 5.20, that is plainly the answer. If
 * they read 5.20 and 5.75, THERE IS NO ANSWER — and the two wrong things to do
 * are to pick one (silently discarding the other) or to average them (inventing
 * a rate nobody agreed). The cell is left BLANK, which the grid already draws as
 * "not priced yet" and the Save gate already refuses on.
 *
 * ## Why this file has no imports
 *
 * So `scripts/check-price-modes.mts` can run it under bare node with no
 * bundler. This decides what a garment is invoiced at; it is worth proving
 * rather than eyeballing. (The same constraint keeps `uniformApproval` in
 * `approval-tree.ts` — see the note in `approval-qty.ts`.)
 */

/** A rate as the grid holds it: the price is the STRING an `<Input>` carries. */
export type RateCell = {
  /** "" means the rate is not per colour — it applies to all of them. */
  combo: string;
  /** null means the rate is not per size — it applies to all of them. */
  size_id: string | null;
  price: string;
};

/** A (colour, size) the newly chosen mode wants a rate for. */
export type WantedCell = { combo: string; size_id: string | null };

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * Could this existing rate be talking about this cell?
 *
 * COMPATIBLE, NOT EQUAL, and the difference is the whole mechanism. An axis is
 * only a disagreement when BOTH sides name something and the two differ; a
 * blank on either side is a wildcard. That one predicate covers widening and
 * narrowing at once — widening because the source is blanker than the cell,
 * narrowing because the cell is blanker than the source — instead of a table of
 * sixteen mode-to-mode transitions that would each need their own rule and
 * their own bug.
 */
function covers(source: RateCell, wanted: WantedCell): boolean {
  const comboOk = !norm(source.combo) || !norm(wanted.combo) || norm(source.combo) === norm(wanted.combo);
  const sizeOk = !source.size_id || !wanted.size_id || source.size_id === wanted.size_id;
  return comboOk && sizeOk;
}

/**
 * The rate a cell inherits from what is already entered, or "" when nothing
 * unambiguous does.
 *
 * BLANK SOURCES ARE IGNORED RATHER THAN COUNTED. A half-filled grid is the
 * normal state of this tab, and letting an unanswered rate count as a
 * disagreement would mean a single blank cell suppressed a carry-over that was
 * otherwise unanimous — the operator would watch a price they had typed vanish
 * because of one they had not.
 */
export function adoptedPrice(
  wanted: WantedCell,
  sources: readonly RateCell[],
): string {
  const seen = new Set<string>();
  for (const s of sources) {
    if (!covers(s, wanted)) continue;
    const p = s.price.trim();
    if (p) seen.add(p);
  }
  return seen.size === 1 ? [...seen][0] : "";
}

/**
 * Reshape one style's rates onto the cells a new mode wants.
 *
 * Returns exactly one entry per wanted cell, in the order given, each carrying
 * the price it inherits and the `key` of the row that already held that exact
 * (colour, size) — so a cell that survives the change keeps its React identity
 * and its cursor rather than being remounted underneath the operator.
 *
 * NOTHING IS LEFT OVER, which is the point: every row this style had is either
 * matched to a cell or superseded by one, so no row can keep a stale
 * `price_type`, drop out of the grid, and go on blocking `orderValue` from
 * behind an amber block.
 */
export function reshapeRates(
  wanted: readonly WantedCell[],
  existing: readonly (RateCell & { key: string })[],
): { combo: string; size_id: string | null; price: string; key: string | null }[] {
  return wanted.map((w) => {
    const exact = existing.find(
      (x) => norm(x.combo) === norm(w.combo) && (x.size_id ?? null) === (w.size_id ?? null),
    );
    return {
      combo: w.combo,
      size_id: w.size_id,
      // An exact match keeps ITS OWN price even when it is blank: the operator
      // deliberately leaving a declared cell empty is an answer about that cell,
      // and inheriting a neighbour's rate over it would fill a gap they left on
      // purpose. Only a cell with no row of its own goes looking.
      price: exact ? exact.price : adoptedPrice(w, existing),
      key: exact?.key ?? null,
    };
  });
}
