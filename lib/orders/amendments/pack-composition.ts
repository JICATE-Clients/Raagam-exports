/**
 * Retail SET packs — what one pack holds, and the explosion into pieces (0467).
 *
 * Client, recording of 2026-08-25: an order may be sold as consumer-facing sets
 * — a kid's pyjama set (1 Top + 1 Bottom), a 3-pack of bodysuits in different
 * colours. The buyer orders BOXES, the factory makes GARMENTS, and the price on
 * the invoice is per box.
 *
 * ## THE EXPLOSION HAPPENS HERE, AND ONLY PIECES LEAVE
 *
 *     pieces per pack = SUM over the composition of qty_per_pack
 *     PO Qty          = packs ordered x pieces per pack
 *
 * `targetsOf` in `lib/orders/material-bom/requirement.ts` folds an approval row
 * into a production target through an exhaustive THREE-BRANCH switch on
 * `BaseQuantityRule`, and **not one branch carries a multiplier**. Neither does
 * `fullTarget`, `materialTarget`, `totalProductionQty`, `bom-ceiling.ts`, or
 * `order-value.ts`'s `po_qty x rate`.
 *
 * So a `po_qty` holding PACKS would under-buy every trim and every kilo of
 * cloth by the set size, silently, and each individual figure would still look
 * plausible on its own screen. Worse than a flat factor: the rejection tiers are
 * non-linear, so the buffer would be drawn from the wrong bracket as well.
 *
 * This module is therefore the ONLY place packs become pieces, it runs in the
 * browser, and what it produces is what Save stores. Exactly the shape the
 * carton explosion already uses one tab across (`lineQtyOf` multiplies cartons
 * x inners x ratio and stores pieces).
 *
 * ## THERE IS NO `pieces_per_pack` COLUMN
 *
 * It is the sum of rows that are already stored, and a field for a sum is a
 * second source of truth for an addition. The assortment side has refused
 * exactly this column twice — 0414 stored `no_of_cartons` and refused
 * `pcs_per_pack`; 0432 restated the test when it admitted `inners_per_carton`
 * ("typed and derivable from nothing, so it earns a column"). `packs_ordered`
 * passes that test. A pack's SIZE does not.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * Inherited from both BOM engines. A pack that cannot be priced out yet — no
 * members, or no pack count — yields `null`, never `0`. On a PO Qty box a zero
 * reads as an order for nothing, which is a claim; "not answered" is not.
 *
 * Client-safe (no `server-only`): the figures recalculate as the operator types,
 * so they run in the browser — and the same functions produce what the server
 * action stores, which is what stops the number the operator approved and the
 * number a BOM is exploded from being derived twice.
 */

/**
 * One member of a pack, as the screen holds it.
 *
 * Every value is a STRING for the reason every numeric box on these screens is:
 * a number cannot represent a just-cleared field, and here that distinction
 * carries meaning — a blank pack count means "not a set pack", a 0 means "no
 * packs ordered".
 *
 * `combo` is part of the row's IDENTITY, not decoration. A 3-pack of bodysuits
 * is ONE coordinate three times over in three colours, so two rows naming the
 * same garment are only a duplicate when the colour matches too. 0467's unique
 * index carries `combo` for the same reason, and `normalizePackComponents`
 * de-duplicates on the same triple — the three must move together or the form
 * and the database disagree about what a duplicate is.
 */
export type PackComponentRow = {
  key: string;
  coordinate_id: string | null;
  combo: string;
  qty_per_pack: string;
};

const n = (v: string | number | null | undefined): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Has the operator started this row?
 *
 * NAMING A GARMENT IS STARTING, and a quantity alone is not. The coordinate is
 * the row's subject; a `qty_per_pack` typed into an otherwise blank row is a
 * number attached to nothing, and treating it as started would make a stray
 * keystroke into a row that blocks Save. This is the same test
 * `styleProcessRowStarted` makes one sheet across, and it is what the
 * normalizer's `.filter((r) => r.coordinate_id)` agrees with on the server.
 */
export function packRowStarted(r: PackComponentRow): boolean {
  return !!r.coordinate_id;
}

/**
 * How many garments one pack holds.
 *
 * Counts every row, including a started row whose quantity is still blank — it
 * contributes 0, so an unfinished composition reads as SMALLER rather than as
 * complete. Under-reading is the safe direction here: it keeps `derivedPoQty`
 * honest and lets `packProblems` complain, where over-reading would let a
 * half-filled pack explode into a confident piece count.
 */
export function piecesPerPack(rows: readonly PackComponentRow[]): number {
  return rows.reduce((a, r) => a + n(r.qty_per_pack), 0);
}

/**
 * The piece count a set-pack style is actually ordering, or `null` when the
 * document does not yet say.
 *
 * `null` on an empty composition OR a missing pack count — both are "not
 * answered", and neither is an order for zero garments.
 */
export function derivedPoQty(
  rows: readonly PackComponentRow[],
  packsOrdered: string | number | null | undefined,
): number | null {
  const per = piecesPerPack(rows);
  const packs = n(packsOrdered);
  if (per <= 0 || packs <= 0) return null;
  return packs * per;
}

/**
 * Whether two members are the same member — the screen's copy of 0467's unique
 * index and of `normalizePackComponents`' de-duplication.
 *
 * Colour is compared case-INSENSITIVELY because `combo` is stored capitalised
 * by the Zod transform but is typed in whatever case the operator used, and a
 * duplicate the form admits is one the database will reject on Save with a
 * `23505` the screen cannot explain.
 */
export function packMemberKey(r: PackComponentRow): string {
  return JSON.stringify([r.coordinate_id ?? "", (r.combo ?? "").trim().toUpperCase()]);
}
