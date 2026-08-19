/**
 * HOW A BLEND READS IN A NAME — one declaration, three readers.
 *
 * The Material master composes a Yarn's and a Fabric's name from its Mixing
 * grid; the Composition master IS nothing but a Mixing grid, and its Name is
 * that blend spelled out. Three call sites, one idea, so the rendering lives
 * here rather than beside any one of them.
 *
 * That is not tidiness. Material's own two branches composed the same blend two
 * different ways for six weeks — Fabric had the legacy shape from 2026-07-23
 * and Yarn printed `45% COTTON / 55% POLYSTER` until 2026-08-04, in ONE file.
 * Composition would have been the third copy.
 */

/**
 * A mixing share as it should READ in a composed name.
 *
 * A grid cell holds the raw string an `<input type="number">` produced, and that
 * is not a number that has been through anything: a typed "050" stays "050", and
 * a legacy row's "45.00" stays "45.00". Straight into the name, that showed the
 * operator `050% 16'S OE COTTON` (client 2026-08-04). Legacy prints `45%`.
 *
 * `Number()` then `String()` is the whole normalisation — it drops leading zeros
 * and trailing zero decimals while leaving a real fraction alone (33.33 stays
 * 33.33). Falls back to the trimmed text if the cell somehow holds a non-number,
 * so a name is never silently emptied by a value the composer could not read.
 */
export function pctText(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw.trim();
}

/** One mixing line as the name composers see it: what it is, and its share. */
export type MixingPart = { pct: string; label: string };

/**
 * THE MIXING LIST, exactly as legacy RP prints it: `COTTON 45%, POLYSTER 55%` —
 * each component NAMED FIRST and its share after, comma-separated.
 *
 * Deliberately no brackets: a Composition's whole name is this list, while a
 * Material's name puts it after a head ("24'S POLYCOTTON …") where the brackets
 * are what separate the two halves. `mixingParens` adds them for that case.
 */
export function mixingList(rows: readonly MixingPart[]): string {
  return rows.map((m) => `${m.label} ${pctText(m.pct)}%`).join(", ");
}

/**
 * The same list wrapped in one pair of brackets, for a name that has a head in
 * front of it: `24'S POLYCOTTON (COTTON 45%, POLYSTER 55%)`.
 */
export function mixingParens(rows: readonly MixingPart[]): string {
  return `(${mixingList(rows)})`;
}
