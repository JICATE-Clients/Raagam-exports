/**
 * WHICH PACK A MATERIAL BOM LINE BUYS IN — resolved from the line's own units
 * when it names no pack of its own.
 *
 * ## Why this exists
 *
 * A BOM line is consumed in one unit and bought in another: a thread is planned
 * in metres and bought in cones, a button in pieces and bought by the gross.
 * `toPurchaseQty` makes that hop, and it needs a `material_uom_conversions` row
 * to make it with. Until 2026-08-21 the line NAMED that row — a "Purchase Pack"
 * cell on the item grid, `uom_conversion_id` — and the client had the cell
 * removed ("remove the purchase pack field from material bom child").
 *
 * The column went and the field stayed, which was right: `writeChildren`
 * deletes and reinserts, so a value the form stops carrying is a value the next
 * save destroys, and the packs already chosen on live BOMs had to survive. What
 * it left behind is a purchase figure with no way to switch it on. Every line
 * created after that date carries `uom_conversion_id = null`, so `packUsable`
 * is false, so `finalQty` falls back to the consumption figure — and the screen's
 * Final Quantity is the metres, in the consumption unit, on every line an
 * operator can make today (client 2026-08-27: "need to show the purchase qty as
 * final ... its showing the consumption qty only").
 *
 * ## The line already says enough
 *
 * It names the material, the Consumption Uom and the Purchase Uom. A conversion
 * row that belongs to that material and converts exactly that pair IS the pack —
 * there is nothing left for the removed cell to have added. So the resolution is
 * derived rather than asked for, which is what the client's two instructions
 * mean when read together.
 *
 * ## AND IT REFUSES TO GUESS WHEN THE PAIR IS AMBIGUOUS
 *
 * A material may be bought in two pack sizes of the SAME unit — the live data
 * has SEWING THREAD / POLYESTER at both `1 CONE = 2500 MTR` and
 * `1 CONE = 5000 MTR`, entered together and both deliberate. Picking either one
 * silently is a purchase quantity wrong by a factor of two, and this number is
 * spent: it is stored as `purchase_qty` and it is what `bomCeilingForOrder` caps
 * a purchase order against.
 *
 * So more than one candidate resolves to NO pack and returns them as `choices`.
 * That is the one case the removed cell was genuinely answering, and the screen
 * shows a chooser for exactly that case rather than on every line.
 *
 * ## One rule, two readers
 *
 * The screen and `requirementRows` in the server action both call this. They
 * must not drift: the server stores `purchase_qty` and the PO ceiling reads the
 * STORED value, so a screen that resolved a pack the server did not would show a
 * purchase figure that no control ever enforced — the same "a control that
 * disagrees with the screen that fed it" failure `requirement.ts` records for
 * summing before converting.
 *
 * Vectors in `scripts/check-bom-requirement.mts`.
 */
import { isUsableConversion, type ConversionLine } from "@/lib/uom/convert";

/** One `material_uom_conversions` row, as both readers hold it. */
export type PackRow = ConversionLine & { id: string; item_id: string };

/** The four fields of a BOM line that decide its pack. */
export type PackLine = {
  item_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  uom_conversion_id: string | null;
};

export type ResolvedPack<C extends PackRow> = {
  /** The pack to convert with, or null when there is none to trust. */
  pack: C | null;
  /**
   * Whether `pack` may actually be used. Kept separate from `pack != null`
   * because a STORED pack can be present and wrong: the pack must convert INTO
   * the unit this line is consumed in, and a cone of metres against a line
   * counted in pieces yields a number and a category error.
   */
  usable: boolean;
  /**
   * The candidates when the line's own units name MORE THAN ONE pack — empty
   * otherwise, including when exactly one matched (it is `pack` then).
   *
   * A caller that ignores this is correct and simply gets no purchase figure;
   * the screen renders it as a chooser so the operator can break the tie.
   */
  choices: readonly C[];
};

export function resolveLinePack<C extends PackRow>(
  line: PackLine,
  conversions: readonly C[],
): ResolvedPack<C> {
  /* THE PACK THE LINE NAMES WINS, ALWAYS. A BOM saved before 2026-08-21 chose
     one by hand, and re-deriving over the top of it would silently move a
     purchase quantity on a document nobody edited. It is not re-validated
     against the units either, beyond the `usable` test below that has always
     applied to it — the behaviour of a stored pack is unchanged by this file. */
  const stored = line.uom_conversion_id
    ? (conversions.find((c) => c.id === line.uom_conversion_id) ?? null)
    : null;

  /* THE MATERIAL'S OWN CONVERSIONS FOR EXACTLY THIS PAIR.
     `purchase_uom_id` is required: with no purchase unit there is no hop to
     make, and a line bought in the unit it is consumed in needs no pack at all.
     `consumption_uom_id` is matched only when set, mirroring `usable` below —
     a line still choosing its consumption unit is half-typed, not wrong. */
  const choices =
    stored || !line.item_id || !line.purchase_uom_id
      ? []
      : conversions.filter(
          (c) =>
            c.item_id === line.item_id &&
            isUsableConversion(c) &&
            c.alt_uom_id === line.purchase_uom_id &&
            (!line.consumption_uom_id || c.base_uom_id === line.consumption_uom_id),
        );

  const pack = stored ?? (choices.length === 1 ? choices[0] : null);
  const usable =
    !!pack &&
    isUsableConversion(pack) &&
    (!line.consumption_uom_id || pack.base_uom_id === line.consumption_uom_id);

  return { pack, usable, choices: choices.length > 1 ? choices : [] };
}
