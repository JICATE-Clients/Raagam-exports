/**
 * WHICH STYLE A DESTINATION PACKS, and therefore which sizes its assortment has
 * columns for.
 *
 * ## WHY THIS IS A MODULE AND NOT FOUR ARROW FUNCTIONS IN THE SCREEN
 *
 * It was four arrow functions in the screen, and the same defect was reported
 * twice in two days (screenshots 2418 and 2419): the assortment overlay opened
 * with NO SIZE COLUMNS AT ALL, so no break-up could be typed and nothing could
 * be saved.
 *
 * Both reports have one cause. `quantities.style_ref_no` stopped being a style
 * reference on 2026-08-17, on the client's own instruction — *"that Ref No field
 * only free text, no more fetching from any table, so remove that wired table
 * connection"*. It holds a DESTINATION reference now; in both screenshots it
 * holds `12`. Anything that still reads it as a style resolves to no style, and
 * a size list resolved from no style is empty.
 *
 * The 2418 fix introduced `inheritedStyleFor` and applied it to one of the two
 * consumers. The other kept the raw field and kept producing an empty grid —
 * and the comment written for that fix even NAMES the function it did not
 * repair. That is not carelessness; it is what a 10,000-line component does to
 * a change. Nothing here could be imported, so nothing here could be covered by
 * a vector, so nothing said the second call site was still wrong.
 *
 * `scripts/check-assort-style.mts` is the point of the move. The functions take
 * `styles` explicitly and touch no React, so the screen keeps thin wrappers that
 * close over its own state and the rules become testable.
 *
 * ## A NAME IS NOT A CONTRACT
 *
 * `style_ref_no` on a `quantities` row and `style_ref_no` on a style row are the
 * same words for different facts. That is exactly why the mis-wiring compiled,
 * type-checked and built clean for weeks — both are `string`. The only defence
 * is to resolve through one named function, which is what this file is.
 */

import { styleKey } from "@/lib/orders/amendments/style-key";

/** A style's size, as the Style(s) section lists it. Order IS the data (0407). */
export type AssortSize = { size_id: string | null };

/** A declared style, reduced to what size resolution needs. */
export type AssortStyle = {
  style_ref_no: string;
  sizes: readonly AssortSize[];
};

/** A destination on the Quantities tab, reduced the same way. */
export type AssortQuantity = {
  /**
   * FREE TEXT SINCE 2026-08-17, and usually a destination reference rather than
   * a style. Never resolve a style from this directly — `inheritedStyleFor` is
   * the only thing that may look at it.
   */
  style_ref_no: string;
  is_single_style_pack: boolean;
  assort_lines: readonly { style_ref_no: string }[];
};

/** Every style reference the order actually declares, normalised and deduped. */
export function declaredStyleRefs(styles: readonly AssortStyle[]): string[] {
  return Array.from(
    new Set(styles.map((s) => s.style_ref_no.trim().toUpperCase()).filter(Boolean)),
  );
}

/** The order's only style, when it declares exactly one — the value a
 *  destination inherits when it names nothing usable itself. */
export function soleStyleRef(styles: readonly AssortStyle[]): string {
  const refs = declaredStyleRefs(styles);
  return refs.length === 1 ? refs[0] : "";
}

/**
 * THE REF NO, BUT ONLY WHEN IT REALLY NAMES A DECLARED STYLE.
 *
 * Matching before using is the whole safety of it: `12` matches no declared
 * style and falls straight through, so the free-text value the client asked for
 * can never be mistaken for a style reference. It was a style PICKER until
 * 2026-08-17, so on real orders it very often still holds a genuine style ref,
 * and those must keep working.
 */
export function declaredStyleRef(styles: readonly AssortStyle[], text: string): string {
  const t = (text ?? "").trim().toUpperCase();
  return t && declaredStyleRefs(styles).includes(t) ? t : "";
}

/**
 * WHAT A DESTINATION INHERITS, in order of how specific the claim is:
 *
 *   1. its own Ref No, IF it names a declared style — the most specific thing
 *      the record says about this destination;
 *   2. otherwise the order's only style, when it declares exactly one — no other
 *      answer is possible, so asking would be noise;
 *   3. otherwise nothing, and the operator picks. With several styles declared
 *      and no clue which this destination packs, a guess would be a wrong
 *      default that saves as if it were an answer.
 */
export function inheritedStyleFor(
  styles: readonly AssortStyle[],
  q: Pick<AssortQuantity, "style_ref_no">,
): string {
  return declaredStyleRef(styles, q.style_ref_no) || soleStyleRef(styles);
}

/**
 * A style's sizes, by reference.
 *
 * A BLANK REF NAMES NO STYLE, said explicitly rather than left to the join.
 * `styleKey("")` is `""`, so a destination that names nothing would otherwise
 * match a Style(s) row whose own Ref No is still blank — the row the operator
 * has just added and not yet filled in — and borrow its sizes.
 */
export function sizesOfRef(
  styles: readonly AssortStyle[],
  ref: string,
): readonly AssortSize[] {
  if (!ref.trim()) return [];
  return styles.find((x) => styleKey(x.style_ref_no) === styleKey(ref))?.sizes ?? [];
}

/** Which style ONE assortment line packs. A line that names its own style wins;
 *  otherwise it takes the destination's inherited one. */
export function assortLineRef(
  styles: readonly AssortStyle[],
  q: Pick<AssortQuantity, "style_ref_no">,
  l: { style_ref_no: string },
): string {
  return l.style_ref_no || inheritedStyleFor(styles, q);
}

/**
 * THE OVERLAY'S SIZE COLUMNS — one style's sizes, or the union of several.
 *
 * Single Style takes the destination's inherited style. Multiple Style has no
 * single answer to take, so the columns are the UNION over every style in play —
 * the destination's, plus each line's.
 *
 * ORDER IS THE DATA (0407), so the union PRESERVES it rather than sorting: each
 * style contributes its sizes in its own declared order, and a size a later
 * style introduces is appended where it first appears. Sorting by the sizes
 * master instead would be stable across styles and would silently re-order a
 * grid the operator has been reading left-to-right all morning.
 *
 * A size is identified by `size_id`, never by its label — two styles naming "3"
 * mean the same `config_lookups` row and must share one column.
 *
 * BOTH BRANCHES GO THROUGH `inheritedStyleFor`. That is the fix for 2419: the
 * single-style branch read the raw Ref No, and the multiple-style branch seeded
 * its union from the raw Ref No, so `12` produced an empty column set either
 * way.
 */
export function sizesForOverlay(
  styles: readonly AssortStyle[],
  q: AssortQuantity,
): readonly AssortSize[] {
  const inherited = inheritedStyleFor(styles, q);
  if (q.is_single_style_pack) return sizesOfRef(styles, inherited);

  const seen = new Set<string>();
  const out: AssortSize[] = [];
  const take = (ref: string) => {
    for (const z of sizesOfRef(styles, ref)) {
      if (!z.size_id || seen.has(z.size_id)) continue;
      seen.add(z.size_id);
      out.push(z);
    }
  };
  take(inherited);
  for (const l of q.assort_lines) take(assortLineRef(styles, q, l));
  return out;
}
