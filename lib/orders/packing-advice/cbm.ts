/**
 * Packing Advice ▸ Carton Volume (CBM) — doc/order/update.md §3.1.
 *
 * A PURE FUNCTION, NEVER A STORED COLUMN (see 0558's own comment on
 * `packing_advice_lines`). CBM is `length_cm x width_cm x height_cm x ctns`,
 * converted from cm³ to m³ (÷ 1,000,000) — one carton's own volume times how
 * many identical cartons this line represents. Any of the four inputs being
 * blank/zero means "not measured yet", not "zero volume", so this returns
 * `null` rather than a confident 0 the operator would read as an answer.
 */
export function computeCbm(
  lengthCm: number | null | undefined,
  widthCm: number | null | undefined,
  heightCm: number | null | undefined,
  ctns: number | null | undefined,
): number | null {
  if (!lengthCm || !widthCm || !heightCm || !ctns) return null;
  return (lengthCm * widthCm * heightCm * ctns) / 1_000_000;
}
