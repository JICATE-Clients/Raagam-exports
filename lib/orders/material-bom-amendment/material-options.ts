import { ACCESSORY_CLASS_CODES, isAccessoryClass } from "@/lib/masters/material-types";
import type { Deactivatable } from "@/lib/masters/inactive";

/**
 * WHICH MATERIALS A BOM LINE MAY NAME.
 *
 * Client rule (2026-08-13): a Material BOM plans **Sewing Accessories and
 * Packing Accessories** — trims and packaging. It is not where fabric or yarn is
 * planned, so offering them is offering a line that cannot be right. That is the
 * outer bound and it has not changed: `getMaterialRows` filters to those two
 * classes before anything here runs.
 *
 * Inside that bound, the Category cell on the row narrows the list.
 *
 * ## THE CASCADE IS NOW CATEGORY-LEVEL, AND UNTIL 0426 IT COULD NOT BE
 *
 * The line's Category used to be a `config_lookups` row of kind
 * `material_category`, which holds exactly two values — "Sewing Accessory" and
 * "Packing Accessory", the names of the two GROUPS (client 2026-08-17,
 * screenshot 2314). So this function could only do the coarse thing: map that
 * group onto an item class and filter materials by class, which narrowed nothing
 * the Material picker did not already know.
 *
 * 0426 repointed `material_bom_amendment_items.category_id` at
 * `public.categories`, the master `items.category_id` has referenced since 0226.
 * **The two sides are the same kind of thing now**, so BUTTON on the line can be
 * compared to BUTTON on the material. That comparison is this function.
 *
 * ## A MATERIAL WITH NO CATEGORY IS UNCLASSIFIED, NOT EXCLUDED
 *
 * Chosen deliberately (client 2026-08-17). The Materials master is still being
 * filled in and a large part of it — the demo seed especially — carries a blank
 * Category, so a strict match would make most of the accessory list unreachable
 * from the BOM with nothing on screen to say why.
 *
 * **But the padding is LABELLED, never silent.** An unclassified material is
 * suffixed "(uncategorised)", so the operator can see the list is wider than the
 * category they picked and can go and classify it. A silent fallback would make
 * the cascade advisory and nobody would ever learn the master needs finishing —
 * the same "empty-and-explain, never fall back" argument AGENTS.md makes for the
 * nominated-vendor list, applied to a partial list rather than an empty one.
 *
 * ## THE MATERIAL A SAVED LINE ALREADY HOLDS ALWAYS SURVIVES
 *
 * Same rule as "Disabled rows", same reason: drop it and a filled cell renders
 * empty, then the next save writes that emptiness over a real FK. Silent data
 * loss dressed up as tidiness.
 */

/** An `items` row, with the two columns the filter reads. */
export type MaterialOption = {
  id: string;
  code: string | null;
  name: string;
  /** The item CLASS code — `SEW`, `PACK`. Null when the item declares none. */
  class_code: string | null;
  /**
   * `items.category_id` — a `public.categories` id since 0226, and since 0426
   * the same kind of value the BOM line's own Category holds. Null is ordinary:
   * it means nobody has classified this material yet.
   */
  category_id: string | null;
} & Deactivatable;

/** Is this item class one a Material BOM plans? Re-exported so a caller filtering
 *  server-side and a caller filtering here cannot answer differently. */
export { isAccessoryClass, ACCESSORY_CLASS_CODES };

/**
 * The materials to offer a line, narrowed by the Category beside it.
 *
 * With no category every accessory material is offered, each **prefixed by its
 * class** — because a name repeats across classes and two identical options the
 * operator has to guess between is the other half of the bug this filter fixes
 * (AGENTS.md, cascading filters).
 */
export function materialsForCategory(
  materials: readonly MaterialOption[],
  opts: { categoryId?: string | null; currentValue?: string | null },
): MaterialOption[] {
  const want = opts.categoryId?.trim() || null;
  const held = opts.currentValue ?? null;

  if (!want) {
    return materials.map((m) =>
      m.class_code ? { ...m, name: `${m.class_code} · ${m.name}` } : m,
    );
  }

  return materials
    .filter((m) => m.category_id === want || m.category_id == null || m.id === held)
    .map((m) =>
      // Only the ones that got in on the blank carve-out are marked. A material
      // that genuinely matches needs no note, and the held value is named by the
      // cell already.
      m.category_id == null ? { ...m, name: `${m.name} (uncategorised)` } : m,
    );
}
