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
  /**
   * THE UNITS THIS MATERIAL ACTUALLY DECLARES (client 2026-08-19).
   *
   * The BOM line's Purchase Uom and Consumption Uom used to offer the whole
   * `uoms` master — 8 rows — for a material that declares ONE. Five of the
   * seven accessory materials in the live database are NOS in every slot, and
   * a picker offering GROSS for a label the master has no gross conversion for
   * is a value nothing downstream can use: `toPurchaseQty` needs a conversion
   * row, and there is none. The operator's word for it was "restrict as full
   * listing".
   *
   * `has_alternate_uom` is the master's own flag for "bought in a different
   * unit than it is consumed in" (0348) and it is what makes the two cases one
   * rule rather than two:
   *
   *   false  ->  base only. `uomSlots` in `material-actions.ts` points all four
   *              slots at `base_uom_id` and forces `conversions` empty, so ONE
   *              unit is not a narrow reading of the master, it is the master.
   *   true   ->  base + the declared purchase unit. BUTTON is NOS consumed and
   *              GROSS bought (1 GROSS = 144 NOS); POLYESTER THREAD is MTR and
   *              CONE. Two values, which is exactly what the client described.
   *
   * NULLS RIDE ALONG RATHER THAN BEING FILTERED. A material whose master has no
   * base unit yet offers nothing here, and the cell says so — 11 items in the
   * live database are in that state (none of them accessories today). Falling
   * back to the full list for those would restore the bug for precisely the
   * materials whose master is unfinished, which is the "empty-and-explain,
   * never fall back" rule this file already applies to the category cascade.
   */
  has_alternate_uom: boolean;
  base_uom_id: string | null;
  purchase_uom_id: string | null;
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
 * ## THE NAME LEADS AND THE CLASS RIDES BEHIND IT (client 2026-08-28)
 *
 * "Displaying the raw Material Name first for readability." Until today the
 * unscoped branch composed `SEW · BUTTON` — the class code, a middle dot, then
 * the thing the operator is actually looking for. It now composes
 * `BUTTON (SEW)`.
 *
 * **The class is kept, not dropped, and that half is deliberate.** This branch
 * fires when NO category is chosen, i.e. when the whole accessory master is on
 * offer, and AGENTS.md's cascading-filters rule is explicit about that state:
 * "with no class chosen, prefix each option by its class … two identical
 * options the operator has to guess between is the other half of the same bug".
 * Two rows both reading POLY BAG, one Sewing and one Packing, is a coin toss
 * that saves the wrong FK, and nothing downstream would object. Deleting the
 * qualifier would answer a readability complaint by reintroducing an ambiguity
 * complaint.
 *
 * **What was actually wrong was the ORDER, and it cost more than a glance.**
 * `RecordPicker` sorts its rows by what is DISPLAYED (`a.label.localeCompare`),
 * so a leading class code sorted the entire list by CLASS first: every PACK
 * material, then every SEW one, with each class's names alphabetised only
 * inside its own block. An operator hunting BUTTON had to know which class it
 * was filed under before the alphabet was any use to them — the list read as
 * unsorted. Putting the name first is what puts the sort back on the name; a
 * mere cosmetic swap of `·` for a dash would have left that untouched.
 *
 * **Parentheses, matching the `(uncategorised)` suffix the other branch already
 * writes.** The two branches are mutually exclusive — one fires with no
 * category, the other with one — so a label can never carry both, and using one
 * shape for both means the operator learns a single rule: the name is the row,
 * anything in brackets after it is the list telling them why the row is here.
 *
 * A material declaring no class is left exactly as it was: a bare name with an
 * empty bracket beside it says nothing and reads as a rendering fault.
 */
export function materialsForCategory(
  materials: readonly MaterialOption[],
  opts: { categoryId?: string | null; currentValue?: string | null },
): MaterialOption[] {
  const want = opts.categoryId?.trim() || null;
  const held = opts.currentValue ?? null;

  if (!want) {
    return materials.map((m) =>
      m.class_code ? { ...m, name: `${m.name} (${m.class_code})` } : m,
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
