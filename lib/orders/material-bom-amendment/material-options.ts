import { ACCESSORY_CLASS_CODES, isAccessoryClass } from "@/lib/masters/material-types";
import type { Deactivatable } from "@/lib/masters/inactive";

/**
 * WHICH MATERIALS A BOM LINE MAY NAME.
 *
 * Client rule (2026-08-13): a Material BOM plans **Sewing Accessories and
 * Packing Accessories** — trims and packaging. It is not where fabric or yarn is
 * planned, so offering them is offering a line that cannot be right.
 *
 * The screen used to hand `RecordPicker` every row of `items`, and the Category
 * cell beside it was a label typed onto the line: a `config_lookups` kind
 * `material_category` (seeded SEW / PACK by 0265) that narrowed nothing and was
 * never compared to the item. That is the exact shape AGENTS.md's *cascading
 * filters* section exists to catch — a facet standing next to the facet it ought
 * to be narrowing.
 *
 * ## THE CATEGORY CELL AND THE ITEM CLASS ARE THE SAME TWO ANSWERS
 *
 * That is what makes this a cascade rather than a new vocabulary. 0265 seeded
 * `material_category` with exactly `SEW` / `PACK`, and `items.item_class_id`
 * resolves to an item class whose codes are also `SEW` / `PACK`
 * (`ACCESSORY_CLASS_CODES` in lib/masters/material-types.ts). So the line's
 * Category answers the same question the item's class does, and one can filter
 * the other with nothing new declared.
 *
 * `material_category` is operator-editable (`LookupDialogPicker` is passed
 * `canCreate`), so a line may hold a category that is neither. That is NOT an
 * error and must not empty the list: an unrecognised category falls back to
 * every accessory material, exactly as a blank one does.
 *
 * ## THE MATERIAL A SAVED LINE ALREADY HOLDS ALWAYS SURVIVES
 *
 * Same rule as "Disabled rows", same reason: drop it and a filled cell renders
 * empty, then the next save writes that emptiness over a real FK. Silent data
 * loss dressed up as tidiness.
 */

/** An `items` row, with the one column the filter reads. */
export type MaterialOption = {
  id: string;
  code: string | null;
  name: string;
  /** The item CLASS code — `SEW`, `PACK`. Null when the item declares none. */
  class_code: string | null;
} & Deactivatable;

/** Is this item class one a Material BOM plans? Re-exported so a caller filtering
 *  server-side and a caller filtering here cannot answer differently. */
export { isAccessoryClass, ACCESSORY_CLASS_CODES };

/** `SEW` / `PACK` off a `material_category` lookup, upper-cased. Null when the
 *  line names no category, or one outside the two the classes know. */
export function categoryClassCode(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return c && ACCESSORY_CLASS_CODES.has(c) ? c : null;
}

/**
 * The materials to offer a line, narrowed by the Category beside it.
 *
 * With no category (or an unrecognised one) every accessory material is
 * offered, each **prefixed by its class** — because a name repeats across
 * classes and two identical options the operator has to guess between is the
 * other half of the bug this filter fixes (AGENTS.md, cascading filters).
 */
export function materialsForCategory(
  materials: readonly MaterialOption[],
  opts: { categoryCode?: string | null; currentValue?: string | null },
): MaterialOption[] {
  const want = categoryClassCode(opts.categoryCode);
  const held = opts.currentValue ?? null;

  if (!want) {
    return materials.map((m) =>
      m.class_code ? { ...m, name: `${m.class_code} · ${m.name}` } : m,
    );
  }
  return materials.filter((m) => m.class_code === want || m.id === held);
}
