/**
 * The panels an ORDER declares — the flattening, on its own so it can be proved.
 *
 * ## WHY THIS IS NOT IN `service.ts`
 *
 * That file is `import "server-only"`, so nothing in it can be reached by a
 * vector. The flattening it used to hold is not plumbing: it decides which
 * fabric each panel is cut from, and that single field is what stops a contrast
 * yoke from being weighed once and charged to two Fabric BOM lines. A rule that
 * expensive living where no test can see it is how the doubling got in.
 *
 * Same call `file-rows.ts` makes one module along ("the arithmetic can live
 * anywhere, so it lives where it can be proved") and `weights.ts` makes for the
 * engine.
 *
 * ## TWO SOURCES, ONE TUPLE
 *
 * A panel IS (style, coordinate, component, fabric) — the tuple
 * `uq_goa_style_components_part` (0457) and `uq_occw_panel` (0460) both key on.
 * Two tables state it and both are needed:
 *
 *   - `garment_order_amendment_style_components` (0457) — Order Info ▸ Styles
 *     Details ▸ Components. The order's OWN panel list, seeded from the style
 *     master and then editable, so a PO can drop a pocket without rewriting the
 *     master for every other order. Preferred: it is at exactly this grain.
 *   - the combo tree, `combos -> _combo_structures -> _combo_components`
 *     (0397 · 0408 · 0409). The fallback, and not redundant — it holds the
 *     panels of every order raised before 0457, which today is all of them.
 *
 * ## BOTH SOURCES CARRY THE FABRIC, AND THE SECOND ONE NEARLY DIDN'T
 *
 * `garment_order_amendment_combo_structures.structure_id` is a **`categories`**
 * row — the SAME vocabulary as `order_fabric_bom_lines.structure_id` and as
 * 0457's `fabric_category_id`. Verified from `pg_constraint`, and that is the
 * only way to know it: **0408 created that column against `config_lookups` kind
 * 'fabric_structure' and 0409 repointed it at `categories` minutes later**
 * ("The reasoning was fine; the premise was wrong, and the CATALOG says so").
 *
 * This module's first version read 0408's comment, believed the vocabularies
 * disagreed, and returned NULL for every combo-tree panel "rather than a
 * mis-cast id". There was no mis-cast to avoid. What it actually did was throw
 * away the fabric axis on every pre-0457 order — which is every order that
 * exists — so the seed fell through to "a weight naming no fabric applies to any
 * structure" and the jersey/rib doubling came back on exactly the orders the
 * axis was added for. A comment is not the catalog.
 */

/** One panel the order declares. */
export type OrderPanelRow = {
  style_ref_no: string | null;
  coordinate_id: string | null;
  coordinate_name: string | null;
  component_id: string | null;
  component_name: string | null;
  /** A `categories` row (0405 · 0409 · 0457) — the fabric this panel is cut
   *  from. NULL only where the source row itself left it blank. */
  fabric_category_id: string | null;
  fabric_category_name: string | null;
};

/** `garment_order_amendment_style_components`, as selected. */
export type StyleComponentSource = {
  style_ref_no: string | null;
  coordinate_id: string | null;
  component_id: string | null;
  fabric_category_id: string | null;
};

/** The combo tree, as PostgREST nests it. */
export type ComboSource = {
  style_ref_no: string | null;
  structures:
    | {
        /** A `categories` row since 0409 — see the header. */
        structure_id: string | null;
        components:
          | { coordinate_id: string | null; component_id: string | null }[]
          | null;
      }[]
    | null;
};

/** id -> display name, for the three masters a panel names. */
export type PanelNames = {
  coordinates: ReadonlyMap<string, string>;
  components: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
};

const EMPTY: ReadonlyMap<string, string> = new Map();

const nameOf = (m: ReadonlyMap<string, string> | undefined, id: string | null) =>
  id ? (m ?? EMPTY).get(id) ?? null : null;

/**
 * A panel IS the tuple (style, coordinate, component, fabric) — NUL-separated
 * because a style ref carries slashes (0402: `STL/2627/0001`) and a printable
 * separator could occur inside one.
 */
export function panelDedupeKey(r: OrderPanelRow): string {
  return [
    r.style_ref_no ?? "",
    r.coordinate_id ?? "",
    r.component_id ?? "",
    r.fabric_category_id ?? "",
  ].join("\u0000");
}

/**
 * Every panel the order declares, from both sources, de-duplicated.
 *
 * THE ORDER'S OWN LIST GOES FIRST, so where a panel appears in both the row that
 * survives is the one from the table the operator edits. They agree on the
 * fabric — both columns are `categories` — so this is about provenance rather
 * than about the value.
 *
 * A row with no component is dropped: that is a half-filled line on the order,
 * which is normal there and has nothing to weigh here.
 */
export function orderPanelRows(
  own: readonly StyleComponentSource[],
  combos: readonly ComboSource[],
  names: Partial<PanelNames> = {},
): OrderPanelRow[] {
  const seen = new Set<string>();
  const out: OrderPanelRow[] = [];

  const push = (r: OrderPanelRow) => {
    if (!r.component_id) return;
    const key = panelDedupeKey(r);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  for (const r of own) {
    push({
      style_ref_no: r.style_ref_no,
      coordinate_id: r.coordinate_id,
      coordinate_name: nameOf(names.coordinates, r.coordinate_id),
      component_id: r.component_id,
      component_name: nameOf(names.components, r.component_id),
      fabric_category_id: r.fabric_category_id,
      fabric_category_name: nameOf(names.categories, r.fabric_category_id),
    });
  }

  for (const c of combos) {
    for (const st of c.structures ?? []) {
      for (const cp of st.components ?? []) {
        push({
          style_ref_no: c.style_ref_no,
          coordinate_id: cp.coordinate_id,
          coordinate_name: nameOf(names.coordinates, cp.coordinate_id),
          component_id: cp.component_id,
          component_name: nameOf(names.components, cp.component_id),
          // THE FABRIC COMES OFF THE STRUCTURE ROW, which is the panel's PARENT
          // in this tree — the components hang under a structure, so the
          // structure IS this panel's fabric. Returning null here instead is the
          // bug the header describes; do not "simplify" it back.
          fabric_category_id: st.structure_id,
          fabric_category_name: nameOf(names.categories, st.structure_id),
        });
      }
    }
  }

  return out;
}

/** Every master id the flattening will need a name for, so the caller can fetch
 *  all three maps in one round trip rather than per row. */
export function panelNameIds(
  own: readonly StyleComponentSource[],
  combos: readonly ComboSource[],
): { coordinates: Set<string>; components: Set<string>; categories: Set<string> } {
  const coordinates = new Set<string>();
  const components = new Set<string>();
  const categories = new Set<string>();

  for (const r of own) {
    if (r.coordinate_id) coordinates.add(r.coordinate_id);
    if (r.component_id) components.add(r.component_id);
    if (r.fabric_category_id) categories.add(r.fabric_category_id);
  }
  for (const c of combos) {
    for (const st of c.structures ?? []) {
      if (st.structure_id) categories.add(st.structure_id);
      for (const cp of st.components ?? []) {
        if (cp.coordinate_id) coordinates.add(cp.coordinate_id);
        if (cp.component_id) components.add(cp.component_id);
      }
    }
  }
  return { coordinates, components, categories };
}
