/**
 * WHAT HAPPENS TO A BOM LINE'S UNITS WHEN ITS MATERIAL CHANGES.
 *
 * Two rules that only make sense together, which is why they are one function:
 *
 *   1. **Drop what the new material cannot offer.** A line swapped from a yarn
 *      to a button kept `KGS` in both Uom cells, because the picker's option
 *      list always keeps the CURRENT value on it — so the cell looked correct,
 *      offered the stale unit, and would save "buttons in kgs", a pair the
 *      material master does not support and that breaks purchase-order
 *      generation downstream.
 *   2. **Fill both cells when the material declares one unit.** In 60-80% of
 *      cases a material is bought and consumed in the same unit (client
 *      2026-08-28), so the operator should not select it twice — or, when there
 *      is only one possible answer, at all.
 *
 * THE SECOND RULE IS WHAT MAKES THE FIRST ONE CHEAP. Blanking a stale cell
 * re-arms the "only while blank" guard, so a single-unit material refills it in
 * the same keystroke and a two-unit one is left blank for the operator to
 * choose. One pass, no second render, and the line is never briefly wrong on
 * screen. Split into two handlers they would fight: whichever ran second would
 * either overwrite a deliberate answer or restore a stale one.
 *
 * ## WHY THIS IS A MODULE AND NOT AN ARROW FUNCTION IN THE CELL
 *
 * It was one, and it is the shape `assort-style.ts` records the cost of: a rule
 * that lives inside a 14,000-line screen cannot be imported, so it cannot be
 * vectored, so nothing tells you when one of its four branches stops being
 * true. The branches here are worth pinning down — each of them is the
 * difference between a shortcut and corrupt BOM data, and three of them only
 * fire on an edit path nobody exercises by hand.
 *
 * Takes ids and plain rows, touches no React, and returns a PATCH rather than
 * mutating — so the screen keeps a one-line call site and the rule is testable
 * without building a grid.
 */

/** The three fields a material change can invalidate. */
export type UomLine = {
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  /**
   * The chosen pack (`material_uom_conversions.id`), which is scoped to a
   * MATERIAL — see `packConversionItemId`.
   */
  uom_conversion_id: string | null;
};

/** A conversion row, reduced to the two columns this rule reads. */
export type ConversionOwner = { id: string; item_id: string };

/**
 * THE PATCH TO APPLY WHEN A LINE'S MATERIAL BECOMES `newItemId`.
 *
 * `declaredUomIds` is what the NEW material offers — its base unit, plus its
 * purchase unit when it declares an alternate. Ask for it with no "current"
 * value: the question is "what would the cell OFFER?", never "what is on the
 * list?", because an option list that keeps a stored value would answer the
 * second question with a stale unit and this rule would preserve it.
 *
 * Returns only the keys that CHANGE, so a caller can spread it over a line and
 * a no-op swap writes nothing.
 */
export function uomPatchForMaterial(
  line: UomLine,
  newItemId: string | null,
  declaredUomIds: readonly string[],
  conversions: readonly ConversionOwner[],
): Partial<UomLine> {
  const patch: Partial<UomLine> = {};

  /**
   * CLEARING THE MATERIAL CLEARS NOTHING.
   *
   * Only a NEW material can contradict a held unit; with none chosen nothing is
   * invalid, and the values stay the operator's to remove. It matters because
   * the picker's ✕ is one mis-click from wiping three cells that would then
   * have to be re-answered — and because a line with no material is a half-typed
   * line, not a wrong one.
   */
  if (!newItemId) return patch;

  const declared = new Set(declaredUomIds);
  const offered = (u: string | null) => !!u && declared.has(u);

  const purchase = offered(line.purchase_uom_id) ? line.purchase_uom_id : null;
  const consumption = offered(line.consumption_uom_id)
    ? line.consumption_uom_id
    : null;
  if (purchase !== line.purchase_uom_id) patch.purchase_uom_id = purchase;
  if (consumption !== line.consumption_uom_id) {
    patch.consumption_uom_id = consumption;
  }

  /**
   * THE PACK GOES WITH THEM, AND IT IS THE DANGEROUS ONE.
   *
   * `resolveLinePack` takes a STORED `uom_conversion_id` verbatim — it looks the
   * id up and its own comment says it is "not re-validated against the units
   * either" — so a swapped material left the OLD material's pack multiplying the
   * purchase quantity. A gross of 144 applied to a thread, on the field that
   * decides what gets bought, with every figure on screen still looking checked.
   *
   * MATCHED ON THE CONVERSION'S OWN `item_id`, never on the unit pair: two
   * materials can share a pair and mean different packs, which is the same
   * reason `packSuffixFor` scopes by `item_id` and offers no fallback.
   *
   * A conversion id that resolves to NOTHING is dropped too — it names a row
   * that no longer exists, and keeping it would leave `resolveLinePack` with a
   * null pack and the line quietly unpriceable.
   */
  if (line.uom_conversion_id) {
    const held = conversions.find((c) => c.id === line.uom_conversion_id);
    if (!held || held.item_id !== newItemId) patch.uom_conversion_id = null;
  }

  /**
   * EXACTLY ONE, NEVER "THE FIRST OF SEVERAL".
   *
   * A material with an alternate unit declares two, and which of them a line
   * buys in is the decision the screen exists to record — defaulting it would
   * put a value on the field that decides what gets purchased without anybody
   * having answered. The two prompts survive only for the case that earns them:
   * a thread bought in CONES and consumed in MTR.
   *
   * Each cell is tested on its own, so a line that already names a valid
   * Purchase unit still gets its Consumption filled.
   */
  if (declared.size === 1) {
    const only = declaredUomIds[0];
    if (!purchase) patch.purchase_uom_id = only;
    if (!consumption) patch.consumption_uom_id = only;
  }

  return patch;
}
