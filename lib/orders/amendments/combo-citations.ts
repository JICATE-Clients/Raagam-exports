/**
 * A COLOURWAY THE FABRIC BOM USES CANNOT LEAVE THE ORDER (user 2026-11-11).
 *
 * The Fabric BOM stores a line's colourway BY NAME (`order_fabric_bom_lines.combo`,
 * `order_fabric_bom_manual_combos.combo`) — there is no FK to the order's
 * combos, because Order Entry rewrites that grid wholesale on every save and
 * an id would not survive it. So renaming a combo on Order Entry leaves the BOM
 * naming a colourway the order no longer has, and the Yarn & Fabric Requirement
 * report answers every one of those lines with "DUTCH BLUE is not a colourway
 * on this order" and no quantity. That is exactly what happened to
 * HO/RE/26-27/0017: BOM saved at 11:17 under DUTCH BLUE, the combo renamed to
 * BLUE at 11:24, the report broken with nothing said at either save.
 *
 * REFUSED, NOT CARRIED ACROSS. A rename is a delete plus an add in this save
 * (the same reading `fabric-bom/palette.ts` takes for the palette panel), and
 * the app cannot tell "renamed DUTCH BLUE to BLUE" from "dropped DUTCH BLUE and
 * added an unrelated BLUE". Guessing would re-point a BOM's fabric at the wrong
 * colourway with no error anywhere. The operator either keeps the name or
 * changes the BOM first — the Fabric BOM's own colour panel already refuses a
 * cited delete the same way (`citationProblem`).
 *
 * Pure, so the screen and the save action can read one rule.
 */

/** Compare colourways the way every engine does: trimmed, upper-cased. */
const key = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

/**
 * @param cited  colourway names the order's Fabric BOM(s) use
 * @param combos the combos the order is about to be saved with
 * @returns the refusal sentence, or null when every cited colourway survives
 */
export function comboCitationProblem(
  cited: readonly (string | null | undefined)[],
  combos: readonly { combo?: string | null }[],
): string | null {
  const kept = new Set(combos.map((c) => key(c.combo)).filter(Boolean));
  const missing = [...new Set(cited.map(key).filter(Boolean))].filter((c) => !kept.has(c));
  if (missing.length === 0) return null;
  const names = missing.join(", ");
  const verb = missing.length === 1 ? "is" : "are";
  return (
    `${names} ${verb} used on this order's Fabric BOM — keep the colourway name, ` +
    `or change it on the Fabric BOM first`
  );
}
