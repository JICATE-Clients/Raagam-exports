/**
 * CAD marker weights — the gram figure for one garment panel, and what step 3
 * is allowed to do with it.
 *
 * doc/file.md §2: the CAD room measures each coordinate component panel off a
 * finished marker (Front Body 120g, Sleeve 45g, Neck Rib 12g) and those weights
 * are pushed to the Fabric BOM so a merchandiser can compute raw material
 * without waiting for the CAD room. This file is the arithmetic half of that
 * handoff and nothing else: it rolls the sheet's rows up per (style, component,
 * fabric), and it converts a gram weight into a Fabric BOM consumption.
 *
 * Client-safe (no `server-only`), for the reason `approval-qty.ts`,
 * `order-value.ts` and both BOM engines record: the figures have to recalculate
 * as the operator types, so they run in the browser — and the server action
 * that WRITES `order_fabric_bom_lines.consumption` computes from these same
 * functions, which is what stops the number CAD approved and the number
 * purchasing is checked against from being derived twice.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * Inherited from both BOM engines, and it is sharper here because this is the
 * INPUT to the largest line in the order. A panel with no weight yet is NULL and
 * every branch refuses on it by name; nothing in this file returns 0, falls back
 * to a default, or throws. A `Refusal` carries the sentence the screen prints.
 */

import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { ceilToPrecision } from "@/lib/uom/convert";

export type { Refusal };
export { isRefusal };

// ---------------------------------------------------------------------------
// What the sheet holds
// ---------------------------------------------------------------------------

/**
 * One weight row, flattened out of the sheet -> layout -> weight tree.
 *
 * FLATTENED BY THE CALLER, not re-queried here: the screen holds the tree in
 * form state while the operator types, and the server holds it as rows. One
 * shape both can produce is what lets the two compute the same answer.
 *
 * The three label fields are not decoration — every refusal below names the
 * panel it is refusing about, and "a component has no weight" is a sentence
 * nobody can act on.
 */
export type CadWeightRow = {
  /** The style this marker is for. NULL = the sheet did not say. */
  style_ref_no: string | null;
  /** The coordinate (a set's Top / Bottom). NULL on a 'piece' garment. */
  coordinate_id: string | null;
  coordinate_name: string | null;
  component_id: string | null;
  component_name: string | null;
  /**
   * The fabric this panel is cut from — a `categories` row.
   *
   * ONE VOCABULARY, AND EVERY SOURCE SPEAKS IT: `order_fabric_bom_lines.
   * structure_id`, `garment_order_amendment_style_components.fabric_category_id`
   * and `garment_order_amendment_combo_structures.structure_id` all reference
   * `categories` (0405 · 0409 · 0426 · 0457), verified from `pg_constraint`.
   * That last one is the trap: 0408 created it against `config_lookups` kind
   * 'fabric_structure' and **0409 repointed it at `categories` minutes later**,
   * so 0408's header still describes a split that no longer exists. Reading the
   * comment instead of the catalog is what put a NULL here for every combo-tree
   * panel once already — see `panels.ts`.
   *
   * NULL therefore means the SOURCE ROW left it blank, not "this source cannot
   * say". A weight carrying NULL still seeds a line of any structure — see
   * `seedConsumptionFor`.
   */
  fabric_category_id: string | null;
  fabric_category_name: string | null;
  /** Grams per garment for this panel. NULL = not measured yet. */
  grams: number | null;
  /** The roll width the marker was planned against, off the layout. */
  dia: number | null;
  /** Which marker it was measured on, for the duplicate refusal's sentence. */
  layout_label: string;
};

/** One panel's weight, rolled up for a whole style — one row per (style,
 *  component, fabric). */
export type ComponentWeight = {
  /** Normalised with `styleKey` — the Orders module's join key. */
  style_key: string;
  /** As typed, for display. */
  style_ref_no: string | null;
  component_id: string;
  component_name: string;
  /** The fabric this panel is cut from, when the sheet says. Part of the KEY —
   *  see `componentWeightsForOrder`. */
  fabric_category_id: string | null;
  fabric_category_name: string | null;
  /** Grams per garment, summed across the style's coordinates. */
  grams: number;
  /** How many coordinate panels were added together to get there. */
  coordinates: number;
  /**
   * The roll dia, when every contributing panel agrees on one. NULL when they
   * do not — two coordinates cut at different widths have no single dia, and
   * inventing one would put a wrong width on a Fabric BOM line.
   */
  dia: number | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const panelName = (r: CadWeightRow): string =>
  [r.coordinate_name, r.component_name].filter(Boolean).join(" · ") || "This panel";

/**
 * The rollup key, NUL-separated: a style ref may contain slashes and dashes
 * (0402: `STL/2627/0001`) and a printable separator could occur inside one.
 *
 * THE FABRIC IS IN THE KEY. Without it a FRONT BODY in single jersey and a FRONT
 * BODY in 1x1 rib — a contrast yoke, which 0457 calls "an entirely normal
 * garment" — are SUMMED into one figure, and the two Fabric BOM lines that cut
 * them would each take the sum.
 */
const rollupKey = (style: string, componentId: string, fabricId: string | null) =>
  `${style}\u0000${componentId}\u0000${fabricId ?? ""}`;

// ---------------------------------------------------------------------------
// The rollup
// ---------------------------------------------------------------------------

/**
 * Every panel weight the sheet declares, rolled up per (style, component,
 * fabric).
 *
 * ## WHY IT SUMS OVER COORDINATES
 *
 * The Fabric BOM line has a style, a combo, a structure and a component — and NO
 * coordinate axis (`order_fabric_bom_lines`, 0426). A set whose Top and Bottom
 * both carry a FRONT BODY therefore maps to ONE line, and the consumption that
 * line needs is the fabric for the whole set: both front bodies. Summing is the
 * only answer that is right for the destination, and `coordinates` is carried
 * out so the screen can show that two panels went into the figure rather than
 * leaving the operator to wonder why it is double what CAD typed.
 *
 * ## FOUR REFUSALS, AND THREE OF THEM WOULD OTHERWISE BE SILENT
 *
 * A row with no component cannot be matched to anything; a row with no weight
 * would multiply the order by nothing; and the same panel weighed on two markers
 * would be ADDED, doubling the biggest line in the order with nothing on screen
 * to say so. That last one is the one the database cannot catch — `uq_occw_panel`
 * is scoped to a single layout, because the sheet is the weight's grandparent
 * (0460 says so at the index).
 *
 * A sheet with no rows at all is refused too rather than returning an empty map:
 * an empty map seeds nothing and reads exactly like "this order needs no
 * fabric", which is the failure AGENTS.md names under Cascading filters — a
 * wrong answer indistinguishable from a legitimate one.
 */
export function componentWeightsForOrder(
  rows: readonly CadWeightRow[],
): ComponentWeight[] | Refusal {
  if (rows.length === 0) {
    return { refused: "No marker weights have been entered for this order" };
  }

  const out = new Map<string, ComponentWeight>();
  // Panel identity WITHIN the sheet — (style, coordinate, component, fabric),
  // the same four `uq_occw_panel` keys on. The index guards ONE layout; this
  // guards across them, which is the case an index cannot reach because the
  // sheet is the weight's grandparent.
  const seen = new Map<string, string>();

  for (const r of rows) {
    if (!r.component_id) {
      return { refused: `${panelName(r)} names no component — pick the panel it is` };
    }

    const grams = num(r.grams);
    if (grams == null) {
      return { refused: `${panelName(r)} has no marker weight yet` };
    }
    // Belt and braces with the CHECK in 0460: a row read from an import, a
    // fixture or a form that has not been through the database yet has not met
    // that constraint. 0 is not "no fabric needed".
    if (grams <= 0) {
      return { refused: `${panelName(r)} weighs ${grams} g — a panel weight must be more than 0` };
    }

    const sKey = styleKey(r.style_ref_no);
    const panelKey =
      `${sKey}\u0000${r.coordinate_id ?? ""}\u0000${r.component_id}\u0000${r.fabric_category_id ?? ""}`;
    const already = seen.get(panelKey);
    if (already !== undefined) {
      return {
        refused:
          `${panelName(r)} is weighed on two markers (${already} and ${r.layout_label}) — ` +
          `remove one, or the fabric for it is counted twice`,
      };
    }
    seen.set(panelKey, r.layout_label);

    const key = rollupKey(sKey, r.component_id, r.fabric_category_id);
    const prev = out.get(key);
    const dia = num(r.dia);

    if (!prev) {
      out.set(key, {
        style_key: sKey,
        style_ref_no: r.style_ref_no,
        component_id: r.component_id,
        component_name: r.component_name ?? "(unnamed component)",
        fabric_category_id: r.fabric_category_id,
        fabric_category_name: r.fabric_category_name,
        grams,
        coordinates: 1,
        dia,
      });
      continue;
    }

    out.set(key, {
      ...prev,
      grams: prev.grams + grams,
      coordinates: prev.coordinates + 1,
      // AGREEMENT OR NOTHING. Keeping the first dia would hand the Fabric BOM a
      // width that is right for one of the two panels it just added together.
      dia: prev.dia != null && dia != null && prev.dia === dia ? prev.dia : null,
    });
  }

  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Grams -> a Fabric BOM consumption
// ---------------------------------------------------------------------------

/**
 * How many grams are in one unit of a UOM.
 *
 * A DECLARED TABLE, and unknown means REFUSED. The live `uoms` master holds
 * CONE, DZN, GROSS, KGS, LTR, MTR, NOS, PCS and an inactive `kg` — read from the
 * catalog, not remembered — so THERE IS NO GRAM UNIT IN THIS DATABASE TODAY and
 * kilograms is the only mass unit a Fabric BOM line can be in. The gram entries
 * are declared anyway because they cost nothing and the alternative is that
 * adding a GM row to the master silently starts refusing every seed.
 *
 * What must never appear here is a length or a count. A marker weight converted
 * into MTR would be a number with no meaning at all, arriving on a purchase
 * order — which is why the fallback is a sentence rather than a factor of 1.
 */
const GRAMS_PER_UOM: Readonly<Record<string, number>> = {
  KG: 1000,
  KGS: 1000,
  KILOGRAM: 1000,
  KILOGRAMS: 1000,
  G: 1,
  GM: 1,
  GMS: 1,
  GRAM: 1,
  GRAMS: 1,
};

/**
 * The decimals a seeded consumption is written at.
 *
 * FOUR, AND DELIBERATELY NOT THE UOM'S OWN `decimal_places_allowed`. Every UOM
 * in this database declares 2, and `uomPrecision` clamps to a floor of 2 — so
 * rounding a consumption at the UOM's precision turns a 45 g sleeve into 0.05 kg
 * and over-orders it by 11% on every garment in the order. The column is
 * `numeric(14,4)` (0426), which is exactly what a gram weight needs: 1 g is
 * 0.001 kg.
 *
 * The UOM's own precision is still right where the BOM engine already applies
 * it — on the TOTAL requirement, which is the number production is short of.
 * Rounding an INPUT to the precision of an OUTPUT is what this avoids.
 */
export const CONSUMPTION_DP = 4;

/**
 * One panel's gram weight as a Fabric BOM consumption, in `uomCode`.
 *
 * Rounded UP at four decimals, the same call `ceilToPrecision` documents for a
 * requirement: the cost of rounding up is at most a ten-thousandth of a unit and
 * the cost of rounding down is a shortfall on the cutting table. The value is
 * exact for any whole number of grams, so the ceiling only ever bites on a
 * fractional gram.
 */
export function consumptionFromGrams(
  grams: number | null,
  uomCode: string | null,
): number | Refusal {
  const g = num(grams);
  if (g == null) return { refused: "This panel has no marker weight yet" };
  if (g <= 0) return { refused: "A panel weight must be more than 0 g" };

  const code = (uomCode ?? "").trim().toUpperCase();
  if (!code) return { refused: "Choose the unit this consumption is in" };

  const perUnit = GRAMS_PER_UOM[code];
  if (perUnit === undefined) {
    // NAME THE UNIT. "Cannot convert" leaves the operator guessing whether the
    // marker or the BOM line is the thing to change.
    return {
      refused: `A marker weight is in grams and this line's consumption is in ${code} — set the line to KGS`,
    };
  }

  return ceilToPrecision(g / perUnit, CONSUMPTION_DP);
}

// ---------------------------------------------------------------------------
// Matching a weight to a Fabric BOM line
// ---------------------------------------------------------------------------

/** As much of a Fabric BOM line as the seed needs to find its weight. */
export type SeedTargetLine = {
  /** For the refusal's sentence — the line's own row number. */
  sno: number;
  /** NULL = the line covers every style on the order. */
  style_ref_no: string | null;
  component_id: string | null;
  /** `order_fabric_bom_lines.structure_id` — a `categories` row, the SAME
   *  vocabulary a weight's `fabric_category_id` holds. NULL = the line names no
   *  structure. */
  structure_id: string | null;
  /** The line's consumption unit code, e.g. 'KGS'. NULL = not chosen yet. */
  uom_code: string | null;
};

/** What one line would be seeded with. */
export type SeededConsumption = {
  consumption: number;
  /** The roll dia to carry across, when the weights agree on one. */
  dia: number | null;
  /** The weight it came from, so the screen can say where the figure is from. */
  from: ComponentWeight;
};

/**
 * The consumption a Fabric BOM line takes from the CAD sheet, or why it cannot.
 *
 * ## THE STYLE AXIS IS THE SUBTLE ONE
 *
 * A Fabric BOM line's `style_ref_no` is NULLABLE and NULL means "every style on
 * this order" (0426). A CAD weight is always measured for ONE style. So an
 * unscoped line can be seeded only when the sheet holds weights for a single
 * style — with two, there is no single figure and picking either would quietly
 * plan the order's fabric off the wrong garment.
 *
 * That refusal names both styles, because the fix is a decision the operator
 * makes on the BOM ("scope this line to a style") and not one this code can
 * make for them.
 */
export function seedConsumptionFor(
  line: SeedTargetLine,
  weights: readonly ComponentWeight[],
): SeededConsumption | Refusal {
  if (!line.component_id) {
    return { refused: `Line ${line.sno} names no component, so there is no marker panel to weigh` };
  }

  const forComponent = weights.filter((w) => w.component_id === line.component_id);
  if (forComponent.length === 0) {
    return { refused: `Line ${line.sno}: the CAD sheet has no weight for this component` };
  }

  const wantStyle = line.style_ref_no == null ? null : styleKey(line.style_ref_no);
  const forStyle =
    wantStyle === null ? forComponent : forComponent.filter((w) => w.style_key === wantStyle);

  if (forStyle.length === 0) {
    return {
      refused: `Line ${line.sno}: no marker weight for this component on ${line.style_ref_no}`,
    };
  }

  /*
   * ## THE FABRIC AXIS, AND WHY IT PREFERS RATHER THAN FILTERS
   *
   * A panel can be cut in two fabrics on one garment — 0457 calls a contrast
   * yoke "an entirely normal garment" and keys its own table that way — and the
   * Fabric BOM has a line per (style, combo, STRUCTURE, component). So a
   * component weighed once against two lines of different structures would have
   * both lines take the whole weight.
   *
   * The match is a PREFERENCE, not a filter, because `fabric_category_id` can
   * legitimately be NULL — a panel whose source row never named a fabric, and
   * every weight entered before the column existed. Filtering strictly would
   * refuse those outright; preferring lets them through while still routing a
   * yoke correctly the moment the fabric IS known. So: an exact fabric match
   * wins; failing that a weight that names NO fabric applies to the line
   * whatever its structure; and only when the sheet names fabrics and none of
   * them is this line's is the line refused, by name.
   */
  const exactFabric = line.structure_id
    ? forStyle.filter((w) => w.fabric_category_id === line.structure_id)
    : [];
  const unstatedFabric = forStyle.filter((w) => w.fabric_category_id == null);

  let matches = forStyle;
  if (line.structure_id) {
    if (exactFabric.length > 0) matches = exactFabric;
    else if (unstatedFabric.length > 0) matches = unstatedFabric;
    else {
      const fabrics = forStyle
        .map((m) => m.fabric_category_name ?? "another fabric")
        .join(", ");
      return {
        refused:
          `Line ${line.sno}: this component is weighed only in ${fabrics}, and this line ` +
          `cuts it in a different fabric — weigh it for this structure too`,
      };
    }
  }

  if (matches.length > 1) {
    // TWO DIFFERENT AMBIGUITIES, TWO DIFFERENT SENTENCES. Both leave the
    // operator with one match to make, and telling them to scope the STYLE when
    // the styles already agree sends them to the wrong cell.
    const styles = new Set(matches.map((m) => m.style_key));
    if (styles.size > 1) {
      const named = matches.map((m) => m.style_ref_no ?? "(unnamed style)").join(", ");
      return {
        refused:
          `Line ${line.sno} covers every style, and this component is weighed for ${named} — ` +
          `scope the line to one style`,
      };
    }
    const fabrics = matches.map((m) => m.fabric_category_name ?? "no fabric").join(", ");
    return {
      refused:
        `Line ${line.sno}: this component is weighed in ${fabrics} and the line names no ` +
        `structure — set the line's Structure so it takes the right one`,
    };
  }

  const w = matches[0];
  const consumption = consumptionFromGrams(w.grams, line.uom_code);
  if (isRefusal(consumption)) {
    // Carry the line number in: the same sentence appears against several lines
    // otherwise and the operator cannot tell which one to open.
    return { refused: `Line ${line.sno}: ${consumption.refused}` };
  }

  return { consumption, dia: w.dia, from: w };
}
