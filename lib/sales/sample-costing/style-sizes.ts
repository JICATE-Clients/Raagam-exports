/**
 * THE SIZES A COSTING OFFERS COME FROM THE STYLE, AND THE OPERATOR CHOOSES
 * (user 2026-10-08: "the size is from Order Entry style field size", then
 * "size is user control, not a default").
 *
 * A style carries its OWN ticked sizes (Sample Entry ▸ style ▸ Sizes, table
 * `style_sizes`, stored by name: S, M, L …). Since 0693 the weights table keeps
 * its columns, and the quotes their prices, against those NAMES — so there is no
 * Size Group in the way, and nothing in this file chooses anything: it only
 * answers two questions about names.
 *
 * - `offeredSizes` — which of the style's sizes are still free to add;
 * - `sizesNotInStyle` — which sizes a sheet HOLDS that the style no longer has.
 *   It only REPORTS; a saved column is never dropped or rewritten.
 *
 * Sizes compare trimmed and case-insensitively ("xl " is "XL"). Pure, with no
 * word of its own: every size comes from the style.
 */

/** The comparison form of a size name. */
export const normSize = (s: string) => s.trim().toUpperCase();

/** The style's sizes, trimmed, blanks dropped, repeats dropped (first spelling wins). */
export function cleanSizes(sizes: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sizes) {
    const t = (raw ?? "").trim();
    if (!t || seen.has(normSize(t))) continue;
    seen.add(normSize(t));
    out.push(t);
  }
  return out;
}

/** The style's sizes the sheet does not hold yet, in the style's own order. */
export function offeredSizes(styleSizes: readonly string[], held: readonly string[]): string[] {
  const have = new Set(held.map(normSize));
  return cleanSizes(styleSizes).filter((s) => !have.has(normSize(s)));
}

/** Sizes the sheet holds that the style does not carry (a size un-ticked since, or a pre-0693 group name). */
export function sizesNotInStyle(styleSizes: readonly string[], held: readonly string[]): string[] {
  const has = new Set(cleanSizes(styleSizes).map(normSize));
  return held.filter((s) => !has.has(normSize(s)));
}
