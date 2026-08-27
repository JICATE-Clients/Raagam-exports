/**
 * Pack type(s) → the Assortment's piece counts (0472, client ruling
 * 2026-08-27).
 *
 * A pack type's lines say what ONE box of that method holds — "ABC PK" is
 * 1 WHITE + 1 GREEN + 2 BLACK, four garments. The Assortment says how many
 * boxes. Multiplying the two is the only way the order's colour-wise piece
 * counts can exist at all, and this module is the only place it happens.
 *
 * ## WHY IT IS MANDATORY AND NOT A CONVENIENCE
 *
 * Client's own words: keeping the two grids as unlinked statements is "a
 * silent, total costing failure downstream". The mechanism is the invariant
 * `pack-composition.ts` already records at length — `targetsOf` in
 * `lib/orders/material-bom/requirement.ts` folds an approval row into a
 * production target through an exhaustive three-branch switch and NOT ONE
 * BRANCH CARRIES A MULTIPLIER, and neither does `fullTarget`,
 * `materialTarget`, `totalProductionQty`, `bom-ceiling.ts` or `order-value.ts`
 * with its `po_qty x rate`.
 *
 * So a quantity row holding BOXES under-buys every trim and every kilo of
 * cloth by the pack size, silently, with each individual figure still
 * plausible on its own screen. 1,000 boxes of the pack above is 4,000
 * garments; read as pieces it buys thread for a quarter of the order.
 *
 * ## ONLY PIECES LEAVE, AND THERE IS NO `pieces_per_pack` COLUMN
 *
 * Both rules are inherited rather than restated: the explosion runs in the
 * browser as the operator types, what it produces is what Save stores, and a
 * pack's SIZE is the sum of rows already stored. 0414 refused `pcs_per_pack`,
 * 0467 refused `pieces_per_pack`, and this refuses it a third time.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * A method with no lines, or a colourway that method does not pack, yields
 * `null` — "this cannot be exploded yet" — never `0`, which on a quantity box
 * reads as an order for nothing. Same rule as `derivedPoQty`.
 *
 * Client-safe (no `server-only`): the figures recalculate as the operator
 * types, so they run in the browser — and the same functions produce what the
 * server action stores, which is what stops the number the operator approved
 * and the number a BOM is exploded from being derived twice.
 */

import { styleKey } from "./style-key";

/**
 * One line of a pack type, as both the screen and the payload hold it.
 *
 * Structurally identical to `AmendmentPackTypeLine` minus its ids, and stated
 * here rather than imported so this module can be exercised by a `.mts` vector
 * script without dragging the Zod schema and its `server-only` neighbours in.
 * `qty` is `number | string` for the same reason `derivedPoQty` takes both: the
 * screen holds every numeric box as a string so a just-cleared field is
 * representable, and the payload holds a number.
 */
export type PackTypeLineLike = {
  pack_type?: string | null;
  style_ref_no?: string | null;
  combo?: string | null;
  qty?: number | string | null;
};

const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * The comparison key for a pack type and for a colourway.
 *
 * UPPERCASED AND TRIMMED, because every one of these is free text typed by an
 * operator and stored capitalised by the Zod transform. `normalizePackTypes`
 * de-duplicates methods case-insensitively and `normalizePackTypeLines` keys on
 * the same uppercased value; matching with `===` here would compile, run, and
 * quietly explode nothing — the failure AGENTS.md records for the supply-type
 * enums, where `"Nominated"` and `"nominated"` are the same word to everyone
 * except the comparison.
 */
const key = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

/** The lines of ONE method, for ONE style. `styleKey`, never `===`. */
export function linesOf(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
): PackTypeLineLike[] {
  const pk = key(packType);
  const sk = styleKey(styleRef ?? "");
  return lines.filter(
    (l) => key(l.pack_type) === pk && styleKey(l.style_ref_no ?? "") === sk,
  );
}

/**
 * How many garments of ONE colourway a single pack of this method holds.
 *
 * `null` when the method packs that colourway not at all — a real and common
 * answer, not a zero: a three-colour pack simply contains no PINK, and an
 * Assortment line for PINK must stay unexploded rather than claim an order for
 * none. A line that EXISTS with a blank quantity does read 0, because the
 * operator has named it and not yet said how many.
 */
export function piecesOfComboPerPack(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
  combo: string | null | undefined,
): number | null {
  const ck = key(combo);
  const mine = linesOf(lines, packType, styleRef).filter((l) => key(l.combo) === ck);
  if (!mine.length) return null;
  return mine.reduce((a, l) => a + n(l.qty), 0);
}

/**
 * Every colourway one pack holds, and how many of each — the composition, in
 * the order the lines were entered.
 *
 * Collapses repeats rather than trusting the unique index: `lib/data-io` and a
 * document saved before `uq_goa_pack_type_lines_member` existed can both hand
 * this two rows for one colourway, and a caller counting them as two members
 * would report a pack size the operator never typed.
 */
export function packContents(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
): { combo: string; qty: number }[] {
  const out = new Map<string, { combo: string; qty: number }>();
  for (const l of linesOf(lines, packType, styleRef)) {
    const ck = key(l.combo);
    const held = out.get(ck);
    if (held) held.qty += n(l.qty);
    else out.set(ck, { combo: (l.combo ?? "").trim(), qty: n(l.qty) });
  }
  return [...out.values()];
}

/**
 * How many garments one pack of this method holds in total.
 *
 * Counts a named colourway whose quantity is still blank as 0, so an unfinished
 * composition reads as SMALLER rather than as complete — the same direction
 * `piecesPerPack` takes for a set pack, and for the same reason: under-reading
 * keeps the derived figures honest and lets the screen complain, where
 * over-reading would let a half-filled pack explode into a confident count.
 */
export function piecesPerPack(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
): number {
  return packContents(lines, packType, styleRef).reduce((a, c) => a + c.qty, 0);
}

/** One exploded cell: the pieces of one colourway in one size. */
export type ExplodedCell = {
  combo: string;
  size_id: string;
  /** PIECES. Never boxes — see the header. */
  qty: number;
};

/**
 * THE EXPLOSION — boxes per size, times the composition, into pieces.
 *
 *     pieces(combo, size) = packs(size) x piecesOfComboPerPack(combo)
 *
 * Returns one cell per (colourway the method packs) × (size with a box count),
 * so a size the operator has not filled in contributes nothing at all rather
 * than a row of zeros. An EMPTY result is the honest answer for a method with
 * no lines or an order with no box counts, and callers must treat it as "not
 * answered yet" — `derivedPoQty` and `packProblems` are the shape to copy.
 *
 * `packsBySize` IS KEYED BY SIZE AND NOT BY (COLOURWAY, SIZE), and that is the
 * whole grain of this feature: one box holds every colourway at once, so the
 * count of boxes is a property of the SIZE. Asking it per colourway would let
 * the operator type 100 against WHITE and 90 against BLACK for one size and
 * silently mean two different pack counts for the same physical carton.
 */
export function explodePacks(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
  packsBySize: ReadonlyMap<string, number | string | null | undefined>,
): ExplodedCell[] {
  const contents = packContents(lines, packType, styleRef);
  if (!contents.length) return [];
  const out: ExplodedCell[] = [];
  for (const [size_id, packs] of packsBySize) {
    const boxes = n(packs);
    /* A SIZE NOT ORDERED IS NOT A ROW OF ZEROS. Zero boxes of Size S is the
       operator saying nothing about S, and emitting cells for it would put an
       explicit "0 pieces" into a table the balance rule then reads back. */
    if (boxes <= 0 || !size_id) continue;
    for (const c of contents) {
      if (c.qty <= 0) continue;
      out.push({ combo: c.combo, size_id, qty: boxes * c.qty });
    }
  }
  return out;
}

/**
 * The whole order's piece count for one method — what every BOM engine will
 * read, and the figure to check against PO Qty.
 *
 * `null`, not 0, when there is nothing to explode: an empty composition or no
 * box counts at all. A screen showing 0 against a PO Qty of 1,000 says the
 * operator ordered nothing; a blank says nobody has answered yet, and only one
 * of those is true.
 */
export function totalPiecesFromPacks(
  lines: readonly PackTypeLineLike[],
  packType: string | null | undefined,
  styleRef: string | null | undefined,
  packsBySize: ReadonlyMap<string, number | string | null | undefined>,
): number | null {
  const cells = explodePacks(lines, packType, styleRef, packsBySize);
  if (!cells.length) return null;
  return cells.reduce((a, c) => a + c.qty, 0);
}
