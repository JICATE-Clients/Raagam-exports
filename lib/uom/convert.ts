/**
 * Alternative-UOM arithmetic — the one place conversions are computed.
 *
 * A factory plans in a base unit and buys in an alternative unit:
 *
 *   thread   1,000 pcs × 200 m/pc = 200,000 m ÷ (2,500 m per cone)  =  80 Cone
 *   buttons    600 pcs ×   4 no/pc =   2,400 no ÷ (144 no per gross) = 16.67 Gross
 *
 * Conversion rows (`material_uom_conversions`, migration 0226) store the
 * relationship as a PAIR — `alt_qty` of `alt_uom` equals `base_qty` of
 * `base_uom` — not as a single factor. That survives a user entering
 * "12 Cone = 30,000 MTR" instead of "1 Cone = 2,500 MTR", and it lets the pack
 * label be derived from real data rather than typed and kept in sync by hand.
 *
 * Pure functions only: no DB, no React. Imported by both the material master
 * screen and the BOM amendment planning calc.
 */

import { fmtNumber } from "@/lib/format";

/** One stored conversion row. Quantities are nullable — a row being typed is
 *  half-filled, which is normal, not an error. */
export type ConversionLine = {
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

/**
 * Base units delivered by ONE alternative unit.
 *
 *   { alt_qty: 1,  base_qty: 2500  } → 2500   (1 cone holds 2,500 m)
 *   { alt_qty: 12, base_qty: 30000 } → 2500   (same pack, entered per dozen)
 *
 * Returns `null` when the line cannot yield a trustworthy factor. A half-filled
 * row is the normal state of a row being typed, NOT an error — but it must stay
 * inert rather than be "helpfully" completed. Defaulting a missing `alt_qty` to
 * 1 would make an unfinished line silently compute, and the number it produced
 * would go onto a real purchase order.
 *
 * Zero and negative quantities are rejected for the same reason: in JS
 * `2500 / 0` is `Infinity`, not a throw, so it would escape into the UI as a
 * perfectly ordinary-looking number.
 */
export function conversionFactor(line: ConversionLine): number | null {
  const alt = line.alt_qty;
  const base = line.base_qty;
  if (alt == null || base == null) return null;
  if (!Number.isFinite(alt) || !Number.isFinite(base)) return null;
  if (alt <= 0 || base <= 0) return null;
  return base / alt;
}

/**
 * Total base requirement → quantity in the alternative (purchase) unit.
 *
 *   toPurchaseQty(200_000, { alt_qty: 1, base_qty: 2500 }, 2) → 80
 *   toPurchaseQty(  2_400, { alt_qty: 1, base_qty:  144 }, 2) → 16.67
 *
 * @param totalBase  order qty × consumption per piece, in the base unit
 * @param decimals   the alternative UOM's `uoms.decimal_places`
 *
 * Returns `null` when the line has no usable factor.
 *
 * The client chose EXACT DECIMALS over rounding up to whole packs — 16.67
 * Gross, not 17. Two things protect that choice:
 *
 *  - `decimals` is floored at 2. Every UOM in the live DB stores 0 in the
 *    precision column, and honouring a 0 here would render 16.67 as "17" and
 *    quietly reinstate the round-up that was rejected. A caller that genuinely
 *    wants whole units must round at the call site, where it is visible.
 *  - the result is ROUNDED, not truncated. Truncating 16.666… to 16.66 quietly
 *    understates the requirement, and under-buying stops a production line.
 */
export function toPurchaseQty(
  totalBase: number,
  line: ConversionLine,
  decimals: number,
): number | null {
  const factor = conversionFactor(line);
  if (factor == null) return null;
  if (!Number.isFinite(totalBase)) return null;
  const dp = Number.isFinite(decimals) ? Math.min(Math.max(decimals, 2), 6) : 2;
  return Number((totalBase / factor).toFixed(dp));
}

/**
 * Pack label for the planner's dropdown, built from the stored numbers:
 * `"1 Cone = 2,500 MTR"`.
 *
 * @param uomName resolves a uom id to its display name
 *
 * An incomplete line never renders as an empty string — a blank option in the
 * dropdown is one the planner can pick by accident, leaving the BOM line
 * pointing at a conversion that cannot compute. It says so instead, and
 * `isUsableConversion` lets callers drop it from the list entirely.
 */
export function describeConversion(
  line: ConversionLine,
  uomName: (id: string | null) => string,
): string {
  const alt = uomName(line.alt_uom_id);
  const base = uomName(line.base_uom_id);
  if (conversionFactor(line) == null || !line.alt_uom_id || !line.base_uom_id) {
    return "Incomplete conversion — set both quantities and units";
  }
  return `${fmtNumber(line.alt_qty)} ${alt} = ${fmtNumber(line.base_qty)} ${base}`;
}

/** True when a line can actually drive a purchase quantity. Use it to keep
 *  half-finished rows out of the planner's pack picker. */
export function isUsableConversion(line: ConversionLine): boolean {
  return conversionFactor(line) != null && !!line.alt_uom_id && !!line.base_uom_id;
}
