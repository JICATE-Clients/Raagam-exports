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
 * ## THE LIST SHOWS THE MATERIAL NAME AND NOTHING ELSE (client 2026-08-28)
 *
 * "No need to mention the value in the material field listing — just list the
 * material name", naming the two brackets it meant: `(SEW)` and `(PACK)`.
 *
 * ## THIS REVERSES A STANDING RULE, AND THAT IS THE CLIENT'S CALL TO MAKE
 *
 * AGENTS.md's "Cascading filters" section says, of exactly this state: "with no
 * class chosen, prefix each option by its class … two identical options the
 * operator has to guess between is the other half of the same bug". The label
 * has carried the class since, and an earlier version of this note argued the
 * point at length — that two rows both reading POLY BAG, one Sewing and one
 * Packing, are a coin toss that saves the wrong FK with nothing downstream to
 * object.
 *
 * That argument was put to the client and the answer was to drop the brackets.
 * The later instruction wins. It is recorded here rather than quietly obeyed
 * because a reader who finds the AGENTS.md sentence quoted elsewhere is holding
 * a rule this file now deliberately departs from — and because if the wrong
 * material is ever reported as saved against a line, THIS is the paragraph to
 * re-open, not a bug in the picker.
 *
 * ## WHAT STILL SEPARATES TWO SAME-NAMED MATERIALS
 *
 * The ambiguity is narrowed rather than reintroduced whole, and it is worth
 * knowing why before anyone "restores" the suffix as a fix:
 *
 *  - **The picker shows the material CODE beneath the name.** `RecordPicker`
 *    renders `pickerIdentityParts(code, name)`, so two POLY BAGs are two rows
 *    with different codes under them — visibly different, just not classified.
 *    A material with no code is the case this does not cover.
 *  - **The unscoped list is the exception, not the rule.** This branch fires
 *    only while no Category is chosen; the ordinary flow picks a category first
 *    and never sees a cross-class list at all.
 *
 * ## `(uncategorised)` STAYS
 *
 * The client named `(SEW)` and `(PACK)`. The other branch's marker answers a
 * different question — not "which class is this" but "this row is only here
 * because it belongs to no category and the filter let it through" — and
 * without it a row appears under a category it does not belong to with nothing
 * saying why.
 *
 * ## THE SORT FOLLOWS THE NAME, WHICH IS WHAT THE 08-28 SWAP WAS FOR
 *
 * `RecordPicker` sorts by what is DISPLAYED (`a.label.localeCompare`). The
 * label led with the class code until 2026-08-28 (`SEW · BUTTON`), which sorted
 * the whole list by CLASS — an operator hunting BUTTON had to know its class
 * before the alphabet was any use. Moving the name to the front fixed that;
 * dropping the bracket now leaves the sort exactly where that change put it.
 */
export function materialsForCategory(
  materials: readonly MaterialOption[],
  opts: { categoryId?: string | null; currentValue?: string | null },
): MaterialOption[] {
  const want = opts.categoryId?.trim() || null;
  const held = opts.currentValue ?? null;

  // THE NAME ALONE (client 2026-08-28) — see the header for what this departs
  // from and what still separates two same-named materials.
  if (!want) return [...materials];

  return materials
    .filter((m) => m.category_id === want || m.category_id == null || m.id === held)
    .map((m) =>
      // Only the ones that got in on the blank carve-out are marked. A material
      // that genuinely matches needs no note, and the held value is named by the
      // cell already.
      m.category_id == null ? { ...m, name: `${m.name} (uncategorised)` } : m,
    );
}
