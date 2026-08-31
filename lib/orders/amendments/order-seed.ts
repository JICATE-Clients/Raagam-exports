import "server-only";
import { createClient } from "@/lib/supabase/server";
import { styleKey } from "./style-key";
import {
  asItemSubType,
  compositionForStructure,
  DEFAULT_GSM_TOLERANCE,
  type CompositionBlend,
  type FabricBlend,
  type MixingShare,
} from "./combo-rules";
import type {
  AmendmentStyle,
  AmendmentDyeing,
  AmendmentPrint,
  AmendmentStructure,
  AmendmentCombo,
  AmendmentPriceDetail,
  AmendmentApprovalQty,
  AmendmentCountrySize,
  AmendmentPackType,
  AmendmentPackTypeLine,
  AmendmentTaActivity,
  AmendmentStyleProcess,
  AmendmentStyleSize,
  AmendmentStyleComponent,
  AmendmentStyleCoordinate,
  AmendmentPackComponent,
  AmendmentComboStructure,
  AmendmentComboComponent,
  AmendmentAssortLine,
  AmendmentAssortLineSize,
  AmendmentQuantity,
} from "./types";

/**
 * Orders ▸ Garment Order Amendment — seeding the child tabs from the order.
 *
 * An amendment document that starts BLANK cannot be compared to anything: there
 * is no "before", so nothing downstream can answer "what changed?". So picking
 * the SCNo loads the order's current styles / colours / prints / structures /
 * combos / prices / quantities into the tabs, and the operator edits the ones
 * that are amending. This mirrors the header, which already auto-loads from the
 * order (see `OrderPickerRow` in service.ts — "confirmed behaviour: SCNo loads
 * the order").
 *
 * ── The join key is TEXT, deliberately ──────────────────────────────────────
 * Not one order child table carries a `garment_styles` FK. `order_prices`,
 * `order_descriptions`, `order_coordinate_colors`, `order_pack_ratios` and
 * `order_pack_ratio_lines` all identify a style by `style_ref_no` + `style_no`
 * text (0328 · 0329 · 0330). The amendment child tables match that shape, which
 * is why they look denormalised — they are consistent with the module, and
 * adding a uuid FK to them would make them the odd one out AND force a
 * text↔uuid resolution on every read anyway. The key across the whole Orders
 * module is `(sales_order_id, style_ref_no)`.
 *
 * `garment_order_amendment_styles.style_id` is the one exception (0128): the
 * Style(s) tab has a real picker. It is resolved by NAME here, and left null
 * when the order's `style_no` names no style master — never invented.
 *
 * ── What this file does NOT do ──────────────────────────────────────────────
 * It does not write anything, and it does not apply an amendment back to the
 * order. Whether approval mutates the live `sales_orders` is still an open
 * question with the client; 0129 records the decision only, on purpose.
 */

/** A child row as it exists BEFORE the amendment is saved: no id, no parent. */
type Seeded<T> = Omit<T, "id" | "amendment_id">;

/**
 * The combo TREE, seeded (0408).
 *
 * `Seeded<T>` strips `id` and `amendment_id` at the top level only, which is
 * all it ever needed to do while every tab was flat. A combo now nests two
 * levels, and each level's key is assigned by the database DURING the save —
 * so `structures` and `components` need the same treatment applied at their
 * own depth, or a seed would have to invent a `combo_id` for a combo that does
 * not exist yet.
 */
type SeededComboComponent = Omit<AmendmentComboComponent, "id" | "structure_id">;
type SeededComboStructure = Omit<
  AmendmentComboStructure,
  "id" | "combo_id" | "components"
> & { components: SeededComboComponent[] };
export type SeededCombo = Omit<AmendmentCombo, "id" | "amendment_id" | "structures"> & {
  structures: SeededComboStructure[];
};

/**
 * The ASSORT tree, seeded (0414) — same treatment, same reason.
 *
 * `Seeded<T>` strips `id` and `amendment_id` at the top level only. An assort
 * line's `quantity_id` and a size cell's `line_id` are assigned by the database
 * DURING the save, so each level needs the strip applied at its own depth or a
 * seed would have to invent a parent id for a row that does not exist yet.
 */
type SeededAssortLineSize = Omit<AmendmentAssortLineSize, "id" | "line_id">;
type SeededAssortLine = Omit<AmendmentAssortLine, "id" | "quantity_id" | "sizes"> & {
  sizes: SeededAssortLineSize[];
};
export type SeededQuantity = Omit<AmendmentQuantity, "id" | "amendment_id" | "assort_lines"> & {
  assort_lines: SeededAssortLine[];
};

export interface SeededAmendmentChildren {
  styles: Seeded<AmendmentStyle>[];
  dyeings: Seeded<AmendmentDyeing>[];
  prints: Seeded<AmendmentPrint>[];
  structures: Seeded<AmendmentStructure>[];
  combos: SeededCombo[];
  priceDetails: Seeded<AmendmentPriceDetail>[];
  approvalQtys: Seeded<AmendmentApprovalQty>[];
  /**
   * Quantities (0398) — one row per style, carrying its ordered quantity.
   *
   * THE ONLY TAB WITH NO ORDER-SIDE TABLE TO RESTATE. `sales_orders` holds a
   * single header `order_qty` / `delivery_date` / `ship_date` and no per-country
   * or per-consignee split, so there is nothing to mirror the way the other tabs
   * mirror their children. Seeding the per-style quantities off `order_pack_ratios`
   * — the same source Approval Qty uses — is the closest honest starting point:
   * the operator splits a row by country or consignee from there.
   *
   * Country, consignee, warehouse and port are left NULL rather than guessed.
   * The order does not carry them, and a plausible wrong default on a shipping
   * document is worse than an empty cell.
   */
  quantities: SeededQuantity[];
  /**
   * Pack type(s) (0399) — ALWAYS EMPTY FROM AN ORDER, and optional for that
   * reason.
   *
   * Quantities at least had `order_pack_ratios` to start from. Nothing on the
   * order side records a packing METHOD: `order_pack_ratios` holds the ratio
   * lines, not whether the carton is solid or assorted. So there is nothing to
   * restate and the tab starts on its one blank row.
   *
   * It is in this type all the same because `applyRows` maps a saved document
   * through the SAME shape — the tab would otherwise be the one grid whose
   * stored rows had no way back onto the screen.
   */
  packTypes?: Seeded<AmendmentPackType>[];
  /**
   * Pack type(s) ▸ what each method packs (0472) — ALWAYS EMPTY FROM AN ORDER,
   * and optional for the same reason `packTypes` above it is.
   *
   * It cannot be otherwise: these lines hang off a pack type by TEXT, and a
   * `sales_order` names no packing method at all, so there is no parent for a
   * seeded line to belong to. It is in this type all the same because
   * `applyRows` maps a SAVED document through the same shape.
   */
  packTypeLines?: Seeded<AmendmentPackTypeLine>[];
  /**
   * Style(s) ▸ per-style sizes (0407) — ALWAYS EMPTY FROM AN ORDER, and
   * optional for the same reason `packTypes` above is.
   *
   * A `sales_order` records no per-style size list at all: `so_line_items.size`
   * is one text size per LINE, which is a different statement (a quantity
   * against a size, not the set of sizes the style is made in), and mapping one
   * onto the other would invent a size set from whatever the order happened to
   * line-item. The sizes come from the STYLE, at the moment the operator picks
   * it — `pickStyle` fills them from `StylePickerRow.sizes`.
   *
   * It is in this type all the same, because `applyRows` maps a SAVED document
   * through the same shape; without it the sub-grid would be the one grid whose
   * stored rows had no way back onto the screen.
   */
  styleSizes?: Seeded<AmendmentStyleSize>[];
  /**
   * Order Info ▸ Styles Details ▸ Coordinates (0461).
   *
   * Same standing as the sizes and the components: the ORDER SEED never fills
   * it — an order carries no coordinate list of its own, and `pickStyle` copies
   * them in from `garment_style_coordinates` when a style is chosen. It is in
   * this type so `applyRows` can map a SAVED document through the same shape.
   */
  styleCoordinates?: Seeded<AmendmentStyleCoordinate>[];
  /** Retail SET pack members (0467). Never seeded — see the note in the screen. */
  packComponents?: Seeded<AmendmentPackComponent>[];
  /**
   * Order Info ▸ Styles Details ▸ Components (0457).
   *
   * Same standing as the sizes directly above, and for the same two reasons.
   * The ORDER SEED never fills it — an order carries no component list of its
   * own, and `pickStyle` copies the parts in from `garment_style_components`
   * when a style is chosen. It is in this type all the same, because
   * `applyRows` maps a SAVED document through the same shape; without it a
   * saved component list would have no way back onto the screen.
   */
  styleComponents?: Seeded<AmendmentStyleComponent>[];
  /** Style(s) ▸ Process (0411). Keyed by `style_ref_no`, like the sizes. */
  styleProcesses?: Seeded<AmendmentStyleProcess>[];
  /**
   * Order Entry ▸ T&A — the order's Time & Action ladder (0481). ALWAYS EMPTY
   * FROM AN ORDER, and optional for the same reason `packTypes` above is.
   *
   * A `sales_order` records no T&A path of its own: `ta_plan_docs` (0401) is a
   * separate document keyed to the order, not a child of it, and seeding from
   * one would make a plan somebody else wrote read as this order's own. The
   * ladder is seeded on the SCREEN instead, from `ta_activities` ordered by
   * `sequence`, at the moment the tab is first opened.
   *
   * It is in this type all the same, because `applyRows` maps a SAVED document
   * through the same shape — without it the ladder would be the one grid whose
   * stored rows had no way back onto the screen, and its `row_uid` is the one
   * value that MUST round-trip or every save loses the completions recorded
   * against it.
   */
  taActivities?: Seeded<AmendmentTaActivity>[];
  /** Still seeded and still diffed (scripts/check-amendment-diff.mts), but the
   *  Country/Sizewise TAB was withdrawn on 2026-08-10, so the screen no longer
   *  consumes it. Optional rather than deleted: the diff vectors are the only
   *  remaining consumer and they should keep working. */
  countrySizes?: Seeded<AmendmentCountrySize>[];
  /**
   * How many of the order's fabrics are solid / yarn-dyed / melange.
   *
   * NOT ROWS, and deliberately not a tab: melange takes its colour from the
   * purchased yarn and yarn-dyed is coloured before knitting, so both need no
   * dyeing row — a fact the Color/Print tab should SAY rather than enforce.
   * `order_fabrics.item_sub_type` is per fabric ROW, so "this order is melange"
   * is not a well-formed statement and a mixed order is normal; hiding a grid on
   * it would strand rows already saved on a grid that no longer renders.
   */
  fabricTypes?: FabricTypeCounts;
}

/** One `order_fabrics` row, as the seed reads it (0408). */
type OrderFabric = {
  id: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  combo: string | null;
  structure_name: string | null;
  fabric_type: string | null;
  composition: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
  item_sub_type: string | null;
};

/** One `order_fabric_components` row, as the seed reads it (0408). */
type OrderFabricComponent = {
  id: string;
  order_fabric_id: string;
  sno: number;
  coordinate: string | null;
  component: string | null;
  fabric_color: string | null;
  fabric_print: string | null;
  processed_as_trim: boolean | null;
};

/** Counts by `order_fabrics.item_sub_type`; `other` covers null / unrecognised. */
export type FabricTypeCounts = {
  solid: number;
  yarn_dyed: number;
  melange: number;
  other: number;
};

export const EMPTY_SEED: SeededAmendmentChildren = {
  styles: [],
  dyeings: [],
  prints: [],
  structures: [],
  combos: [],
  priceDetails: [],
  approvalQtys: [],
  packTypes: [],
  packTypeLines: [],
  styleSizes: [],
  styleCoordinates: [],
  packComponents: [],
  styleComponents: [],
  styleProcesses: [],
  taActivities: [],
  quantities: [],
  countrySizes: [],
};

/**
 * RE-EXPORTED, NOT DEFINED HERE (0407). The body moved to `style-key.ts` so the
 * amendment SCREEN could call it: this module is `server-only`, and a client
 * component importing it fails the build while passing `tsc`. Every existing
 * `from "./order-seed"` importer is unaffected — which is the point of keeping
 * the name exported from here.
 */
export { styleKey };

// ---------------------------------------------------------------------------
// THE ONE POLICY CALL IN THIS FILE — see the note at the bottom of the module.
// ---------------------------------------------------------------------------

/**
 * The order names its colours, prints and structures as free TEXT
 * (`order_fabric_components.fabric_color` / `.fabric_print`,
 * `order_fabrics.structure_name`). The amendment stores them as uuid FKs into
 * `color_card_colors` and `config_lookups`. So seeding has to resolve text to a
 * master row — and some of it will not resolve, because the order side was
 * never constrained to the masters.
 *
 * DECIDED (2026-08-09): the row is KEPT, with a blank picker, for all three
 * kinds. A colour the order really carries must not vanish from the amendment
 * without the operator seeing it — a blank picker is a visible prompt, a
 * dropped row is silent data loss, and silence is the failure mode nobody
 * catches. The cost is accepted and real: **a seeded amendment can arrive with
 * blanks that must be filled before it will save**, and on an order whose
 * colours were all typed freehand that may be every row in the tab.
 *
 * It stays a function, and stays per-kind, because the obvious next request is
 * to split it — an unmatched colour is worth chasing, an unmatched structure
 * name is often legacy noise. One `if` here, never a condition at a call site.
 */
export function keepUnmatchedMaster(
  _kind: "colour" | "print" | "structure",
  _text: string,
): boolean {
  return true;
}

// ---------------------------------------------------------------------------

/** Case-insensitive text → master id, for the three text-keyed tabs. */
function indexByName(rows: { id: string; name: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = r.name?.trim().toUpperCase();
    if (k && !m.has(k)) m.set(k, r.id);
  }
  return m;
}

/**
 * Read the order as it stands and shape it into the amendment's eight child
 * tabs. Returns `EMPTY_SEED` for an order id that resolves to nothing, so a
 * caller never has to null-check the individual arrays.
 */
export async function seedAmendmentFromOrder(
  salesOrderId: string,
): Promise<SeededAmendmentChildren> {
  if (!salesOrderId) return EMPTY_SEED;
  const s = await createClient();

  // ---- the order's own children -------------------------------------------
  const [{ data: prices }, { data: packs }, { data: fabrics }] = await Promise.all([
    s
      .from("order_prices")
      .select("sno, style_ref_no, style_no, article_no, price_type, rate_uom, rate")
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
    s
      .from("order_pack_ratios")
      .select("id, sno, style_ref_no, style_no, country_code, order_qty")
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
    s
      .from("order_fabrics")
      // Every column the Structure Details overlay shows (0408). 0397 said the
      // source data "has been in hand the whole time; only the destination was
      // missing" — this is the select that stops discarding it.
      .select(
        "id, sno, style_ref_no, style_no, combo, structure_name, fabric_type, " +
          // `other_details` is no longer read: 0412 removed the column from both
        // levels of the amendment tree as clutter (client 2026-08-12). The
        // ORDER side keeps its own, untouched.
        "composition, gsm, gsm_tolerance, item_sub_type",
      )
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
  ]);

  /**
   * CAST ONCE, HERE. The two selects above are built by concatenation (they are
   * long enough that one line was unreadable), and PostgREST's generic types
   * degrade to `T | GenericStringError` the moment a select string is not a
   * literal. Casting at each of the eight use sites would be eight chances to
   * cast to something slightly different; the row shapes are declared at the
   * top of this file precisely so there is one answer.
   */
  const fabricRows = (fabrics ?? []) as unknown as OrderFabric[];

  const packIds = (packs ?? []).map((p) => p.id);
  const fabricIds = fabricRows.map((f) => f.id);

  const [{ data: packLines }, { data: components }] = await Promise.all([
    packIds.length
      ? s
          .from("order_pack_ratio_lines")
          .select("sno, style_ref_no, style_no, combo")
          .in("pack_ratio_id", packIds)
          .order("sno")
      : Promise.resolve({ data: [] as { sno: number; style_ref_no: string | null; style_no: string | null; combo: string | null }[] }),
    fabricIds.length
      ? s
          .from("order_fabric_components")
          // `order_fabric_id` is new here and load-bearing: the components now
          // group under their STRUCTURE (0408) rather than being mined flat for
          // colours and prints. `specifications` stays unread — the client's
          // "not currently used in their workflow" (2026-08-10).
          .select(
            // `fabric_name` is NOT read (0410): Fabric Print is one field on the
            // amendment side, and the order side's own column stays untouched.
            "id, order_fabric_id, sno, coordinate, component, fabric_color, " +
              "fabric_print, processed_as_trim",
          )
          .in("order_fabric_id", fabricIds)
          .order("sno")
      : Promise.resolve({ data: [] as OrderFabricComponent[] }),
  ]);

  const componentRows = (components ?? []) as unknown as OrderFabricComponent[];
  const packLineRows = (packLines ?? []) as unknown as {
    sno: number;
    style_ref_no: string | null;
    style_no: string | null;
    combo: string | null;
  }[];

  /**
   * The order's own yarn-dyed colours, read TWICE from here on (0480).
   *
   * They have always seeded the Color/Print tab's yarn-section dyeings — the
   * order's declared palette. They now ALSO seed each combo structure's
   * `yarn_colors`, the client's new "which pre-dyed yarns is this cloth knitted
   * from" (2026-08-31), because the order states that answer and a seeded
   * amendment that asked for it again would be asking the operator to re-type
   * something their order sheet already settled — the cost this whole file
   * exists to avoid.
   *
   * `fabric_component_id` IS NOW SELECTED, and without it the second reading is
   * impossible rather than merely wrong: the rows are keyed to a COMPONENT, the
   * amendment's field hangs off the STRUCTURE, and the hop between them is
   * `order_fabric_components.order_fabric_id`. Selecting only the value was
   * correct while the only consumer was a flat palette.
   */
  const componentIds = componentRows.map((c) => c.id);
  const { data: yarnColors } = componentIds.length
    ? await s
        .from("order_fabric_yarn_colors")
        .select("sno, fabric_component_id, yarn_dyed_color")
        .in("fabric_component_id", componentIds)
        .order("sno")
    : {
        data: [] as {
          sno: number;
          fabric_component_id: string;
          yarn_dyed_color: string;
        }[],
      };

  // ---- the masters the text has to resolve against ------------------------
  const [{ data: styleRows }, { data: colorRows }, { data: lookupRows }] = await Promise.all([
    s
      .from("garment_styles")
      // `categories`, not `config_lookups` — 0394 repointed style_category_id and
      // kept the constraint name, so the old embed named a relationship that no
      // longer exists and failed the whole seed query (same defect as service.ts).
      .select(
        "id, style_name, article_no, style_description, style_category_id, " +
          // 0461 merged the master's header fields onto the order line, so the
          // seed has to carry them or an order seeded from a style would open
          // with them blank where `pickStyle` fills them on every other route.
          // Season and Year are NOT among them — see 0462.
          "approved_sample_id, " +
          "category:categories!style_category_id(name)",
      )
      .eq("blocked", false),
    s.from("color_card_colors").select("id, name"),
    s
      .from("config_lookups")
      .select("id, kind, name")
      // `fabric_structure`, not the empty `structure` kind — see 0396 and the
      // note on `structureOpts` in amendment-screen.tsx. Matching
      // `order_fabrics.structure_name` against an empty index is why every
      // seeded structure row arrived with a null id and was dropped on save.
      .in("kind", ["roll_form_print", "fabric_structure"])
      .eq("is_active", true),
  ]);

  type StyleMaster = {
    id: string;
    style_name: string | null;
    article_no: string | null;
    style_description: string | null;
    /* 0461 merged the master's header fields onto the order line. `category` is
       the NAME and `style_category_id` is the row it resolves to — the order
       stores both, and they come off this one record so they cannot disagree. */
    approved_sample_id: string | null;
    style_category_id: string | null;
    category: { name: string | null } | null;
  };
  const styleMasters = (styleRows ?? []) as unknown as StyleMaster[];
  const styleByName = new Map<string, StyleMaster>();
  for (const r of styleMasters) {
    const k = r.style_name?.trim().toUpperCase();
    if (k && !styleByName.has(k)) styleByName.set(k, r);
  }

  /**
   * The masters the COMBO TREE resolves text against (0408).
   *
   * Fetched beside the three above rather than inside the combo loop: a lookup
   * per row would be a query per row, and this seed already runs against an
   * order with hundreds of fabric components.
   *
   * `categories` is the Structure list (0409 — SINGLE JERSEY is a category, not
   * a knit family), coordinates are `items` of class GAR (0396) and components
   * are the `components` master (0396). Every
   * one of these was TEXT on the order side because that side was never
   * constrained to the masters, which is exactly why this resolution exists and
   * why a miss is kept-with-a-blank rather than dropped — see the note on
   * `keepUnmatchedMaster`.
   */
  const [
    { data: categoryRows },
    { data: garmentRows },
    { data: componentMasterRows },
    { data: itemClassRows },
    { data: mixingRows },
    { data: compositionRows },
  ] = await Promise.all([
    s.from("categories").select("id, name"),
    // `category_id` RIDES ALONG for the fabric resolution below — and this is
    // the same select the coordinates come out of, so it costs nothing.
    s.from("items").select("id, name, item_class_id, category_id"),
    s.from("components").select("id, short_name"),
    s.from("config_lookups").select("id, code").eq("kind", "item_class"),
    // The two halves of the composition fetch (0434). Flat selects, no embed:
    // `material_mixings` holds TWO FKs to `items`, so an unqualified embed is
    // ambiguous and fails the WHOLE query — the trap `getFabricRows` spells its
    // constraint names out to avoid. Joined in JS below against the `items` rows
    // already fetched above, which is where each yarn's category is.
    s.from("material_mixings").select("item_id, component_item_id, blend_pct"),
    s.from("compositions").select("id, inactive, lines:composition_lines(category_id, mixing_pct)"),
  ]);

  const garIds = new Set(
    ((itemClassRows ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "GAR")
      .map((c) => c.id),
  );
  const categoryByName = indexByName((categoryRows ?? []) as { id: string; name: string | null }[]);
  /**
   * THE FABRICS, BY THE CATEGORY THEY SIT IN — the seeder's half of "Composition
   * is fetched, not typed" (0430, and still true after 0434 moved the ANSWER
   * back to the `compositions` master).
   *
   * This replaced a `compositionByName` index over the `compositions` master,
   * which resolved `order_fabrics.composition` — a free-text phrase like
   * "100% BCI COTTON" — against that master's names. It had never resolved
   * anything: the query filtered `.eq("blocked", false)` on a table whose flag
   * column is spelled `inactive` (0299), so PostgREST failed it outright and the
   * swallowed error left an empty map. Same defect, same day, as the picker in
   * `service.ts`.
   *
   * MATCHED BY CATEGORY, NOT BY NAME, and only when the answer is unambiguous —
   * and the rule itself is now `compositionForStructure()` in `combo-rules.ts`,
   * the SAME function `pickComboStructure` calls on the screen. That is the whole
   * reason it lives in a pure file: a seeded amendment and a hand-picked one must
   * reach the same composition, and two copies of a rule stay identical exactly
   * until one of them is improved.
   *
   * A category with two fabrics in it has no single right answer, so the seed
   * leaves the field blank and the operator picks: "a blank picker is a visible
   * prompt, a dropped row is silent data loss", and inventing one of two fabrics
   * is neither.
   */
  // `fabricClassIds`, NOT `fabricIds` — that name is taken, two hundred lines up,
  // by the ids of the legacy `order_fabrics` ROWS this seed reads. Two different
  // fabrics in one function is exactly the collision that makes a shadowed
  // variable compile and mean the wrong thing.
  const fabricClassIds = new Set(
    ((itemClassRows ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "FABRIC")
      .map((c) => c.id),
  );
  // Every item's category, so a mixing line's YARN can be reduced to the unit a
  // composition speaks in. `garmentRows` is already every item, so this is a
  // re-index rather than another query.
  const categoryOfItem = new Map<string, string | null>(
    ((garmentRows ?? []) as { id: string; category_id: string | null }[]).map((i) => [
      i.id,
      i.category_id,
    ]),
  );
  const mixingByFabric = new Map<string, MixingShare[]>();
  for (const m of (mixingRows ?? []) as {
    item_id: string;
    component_item_id: string | null;
    blend_pct: number | null;
  }[]) {
    const list = mixingByFabric.get(m.item_id) ?? [];
    list.push({
      category_id: m.component_item_id ? categoryOfItem.get(m.component_item_id) ?? null : null,
      pct: m.blend_pct == null ? null : Number(m.blend_pct),
    });
    mixingByFabric.set(m.item_id, list);
  }
  const fabricBlends: FabricBlend[] = ((garmentRows ?? []) as {
    id: string;
    item_class_id: string | null;
    category_id: string | null;
  }[])
    .filter((i) => i.item_class_id && fabricClassIds.has(i.item_class_id) && i.category_id)
    .map((i) => ({ id: i.id, category_id: i.category_id, mixing: mixingByFabric.get(i.id) ?? [] }));
  const compositionBlends: CompositionBlend[] = (
    (compositionRows ?? []) as {
      id: string;
      inactive: boolean | null;
      lines: { category_id: string | null; mixing_pct: number }[] | null;
    }[]
  ).map((c) => ({
    id: c.id,
    inactive: c.inactive ?? false,
    lines: (c.lines ?? []).map((l) => ({
      category_id: l.category_id,
      mixing_pct: Number(l.mixing_pct),
    })),
  }));
  // A COORDINATE IS A GARMENT (0396), so the list is scoped to item class GAR
  // here rather than matched against every item in the database — an item named
  // "PIECES" in some other class would otherwise resolve and be wrong.
  const coordinateByName = indexByName(
    ((garmentRows ?? []) as { id: string; name: string | null; item_class_id: string | null }[])
      .filter((i) => i.item_class_id && garIds.has(i.item_class_id)),
  );
  // The `components` master spells its label `short_name`, so it is reshaped
  // into the {id, name} `indexByName` expects rather than given its own index.
  const componentByName = indexByName(
    ((componentMasterRows ?? []) as { id: string; short_name: string | null }[]).map((c) => ({
      id: c.id,
      name: c.short_name,
    })),
  );

  const colorByName = indexByName((colorRows ?? []) as { id: string; name: string | null }[]);
  const lookups = (lookupRows ?? []) as { id: string; kind: string; name: string | null }[];
  const printByName = indexByName(lookups.filter((l) => l.kind === "roll_form_print"));
  const structureByName = indexByName(lookups.filter((l) => l.kind === "fabric_structure"));

  // ---- Style(s) ------------------------------------------------------------
  // No order-side styles TABLE exists, so the tab is derived: every distinct
  // style the order's prices and pack ratios mention, in first-seen order.
  const styles: Seeded<AmendmentStyle>[] = [];
  const seenStyle = new Set<string>();
  for (const r of [...(prices ?? []), ...(packs ?? [])]) {
    const key = styleKey(r.style_ref_no, r.style_no);
    if (!key || seenStyle.has(key)) continue;
    seenStyle.add(key);
    const master = styleByName.get((r.style_no ?? "").trim().toUpperCase()) ?? null;
    styles.push({
      sno: styles.length + 1,
      style_ref_no: r.style_ref_no ?? r.style_no ?? null,
      style_id: master?.id ?? null,
      approved_sample_id: master?.approved_sample_id ?? null,
      article_no: master?.article_no ?? null,
      /* ORDER UNIT (0471) — NULL, meaning "not answered", even where a master
         row was matched above. A seeded line is a legacy order being read into
         the new shape, and PCS / SET is a word that gets stored on the price
         rows; taking it from a master the operator did not pick would put an
         inferred unit onto an invoice. The screen asks for it, and the
         coordinate derivation still answers where a line has coordinates. */
      unit_kind: null,
      /* THE NAME AND THE ROW IT RESOLVES TO (0461). The text has always been
         seeded from the embed; the id is what a picker can resolve, and both
         come off the same master row here so they cannot disagree. */
      style_category: master?.category?.name ?? null,
      style_category_id: master?.style_category_id ?? null,
      style_description: master?.style_description ?? null,
      // Units and PO qty are amendment-side decisions with no order-side
      // column to read — the operator sets them.
      order_unit_id: null,
      plan_unit_id: null,
      po_qty: 0,
      /* NULL, NOT 0 (0467): a legacy order carries no pack count because it was
         never asked, which is a different statement from "no packs ordered". */
      packs_ordered: null,
      description: null,
    });
  }

  /** Style ref + article for the four text-keyed tabs, off the derived list. */
  const styleLabel = (refNo: string | null, styleNo: string | null) => {
    const hit = styles.find((x) => styleKey(x.style_ref_no) === styleKey(refNo, styleNo));
    return {
      style_ref_no: refNo ?? styleNo ?? null,
      style: styleNo ?? null,
      article_no: hit?.article_no ?? null,
    };
  };

  // ---- Color / Print — dyeings, prints, structures --------------------------
  /**
   * THE COLOUR TEXT NOW SURVIVES THE SEED (0403). The order's colours are typed
   * freehand on the fabric rows, and until Colour Cards was withdrawn the only
   * place to put them was `color_id` — so an unmatched colour arrived as a
   * blank picker the operator had to re-type, the cost `keepUnmatchedMaster`
   * documents above. `color_name` is free text, so the words carry across and
   * that cost is gone for this kind. The id is still resolved where a colour
   * card happens to hold the same name; the guard stays because it is the one
   * `if` for all three text-keyed tabs and print/structure still need it.
   */
  const dyeings: Seeded<AmendmentDyeing>[] = [];
  for (const y of yarnColors ?? []) {
    const text = y.yarn_dyed_color.trim();
    const id = colorByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("colour", y.yarn_dyed_color)) continue;
    dyeings.push({
      sno: dyeings.length + 1,
      section: "yarn",
      dye_type: null,
      color_name: text || null,
      color_id: id,
    });
  }
  for (const c of componentRows) {
    const text = c.fabric_color?.trim();
    if (!text) continue;
    const id = colorByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("colour", c.fabric_color!)) continue;
    dyeings.push({
      sno: dyeings.length + 1,
      section: "fabric",
      dye_type: null,
      color_name: text,
      color_id: id,
    });
  }

  const prints: Seeded<AmendmentPrint>[] = [];
  const seenPrint = new Set<string>();
  for (const c of componentRows) {
    const text = c.fabric_print?.trim();
    if (!text || seenPrint.has(text.toUpperCase())) continue;
    seenPrint.add(text.toUpperCase());
    const id = printByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("print", text)) continue;
    /**
     * THE TEXT CARRIES ACROSS NOW, NOT JUST THE ID (0477).
     *
     * This pushed `print_id` alone, so an order naming a print the master has
     * never heard of seeded a row with an EMPTY cell — the accepted cost the
     * `keepUnmatchedMaster` note states in as many words: "a seeded amendment
     * can arrive with blanks that must be filled before it will save."
     *
     * The order has always carried the print as free text
     * (`order_fabric_components.fabric_print`) and this loop has always had it
     * in `text`; there was simply nowhere on the amendment to put it. There is
     * now, so the operator sees the print the order actually names and the id
     * alone is blank — the same shape `color_name` beside it has used since
     * 2026-08-09, and the reason the two loops now read alike.
     *
     * THE DECISION ABOVE IS UNCHANGED. `keepUnmatchedMaster` still returns true
     * and the row is still kept; what changes is that keeping it is no longer
     * silent about WHAT was kept.
     */
    prints.push({ sno: prints.length + 1, print_id: id, print_name: text });
  }

  /**
   * The structures the STYLE already declares, from its Components tab.
   *
   * "The system should automatically fill these rows based on the fabric
   * structures already defined in the initial Style Entry … pulled directly from
   * the Components tab of the Style setup" (client 2026-08-10). Listing them here
   * is what makes them available to the Combos tab, where colours get mapped onto
   * individual parts.
   *
   * FETCHED HERE RATHER THAN IN THE `Promise.all` ABOVE, because it is keyed on
   * `styles[].style_id`, which does not exist until the derived Style(s) list has
   * been resolved against `styleByName` a few lines up. One extra round trip, and
   * only when the order resolved to at least one style master.
   */
  const styleIds = [
    ...new Set(styles.map((x) => x.style_id).filter((x): x is string => !!x)),
  ];
  const { data: styleComponents } = styleIds.length
    ? await s
        .from("garment_style_components")
        .select("structure_id")
        .in("style_id", styleIds)
    : { data: [] as { structure_id: string | null }[] };

  const structures: Seeded<AmendmentStructure>[] = [];
  // TWO SOURCES, ONE LIST, SO DEDUPE HAS TO WORK IN BOTH CURRENCIES: the order's
  // fabrics carry structure NAMES (free text on `order_fabrics`), the style's
  // components carry structure IDS. A single text-keyed set would let the same
  // structure in twice, once under each.
  const seenStructure = new Set<string>();
  const seenStructureId = new Set<string>();
  for (const f of fabricRows) {
    const text = f.structure_name?.trim();
    if (!text || seenStructure.has(text.toUpperCase())) continue;
    seenStructure.add(text.toUpperCase());
    const id = structureByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("structure", text)) continue;
    if (id) seenStructureId.add(id);
    // THE TYPE COMES WITH THE FABRIC (0415). `order_fabrics.item_sub_type` is
    // the same three-word vocabulary this column takes, and it is the answer the
    // order already gave — the counts feeding `FabricTypeHint` are computed from
    // it a few lines down. Seeding it is what stops a seeded amendment asking
    // the operator to re-answer a question their order sheet settled.
    //
    // 'printed' cannot arrive here, and it is now not a value ANYWHERE. It was
    // the amendment's own fourth value (0412) and `order_fabrics` never had a
    // way to express it, so `asItemSubType` narrowing it away changed nothing
    // on this path either before or after the client removed it on 2026-08-31
    // — the two vocabularies are the same three words again, which is what
    // makes this a copy rather than a translation.
    structures.push({
      sno: structures.length + 1,
      structure_id: id,
      item_sub_type: asItemSubType(f.item_sub_type),
    });
  }
  // UNION, NOT REPLACE. A PO can name a structure the style never mentioned —
  // which is exactly what the spec's "+ Add structure provides manual
  // flexibility" is for — so the order's own rows keep their place at the top.
  for (const c of (styleComponents ?? []) as { structure_id: string | null }[]) {
    const id = c.structure_id;
    if (!id || seenStructureId.has(id)) continue;
    seenStructureId.add(id);
    // NULL, not a guess: a style component says which fabric a part is made of,
    // never how it is coloured. That answer lives on the order's fabric row, and
    // a structure the order never listed has not been given one — the blank is
    // the honest state, and the one that offers neither a colour nor a print.
    structures.push({ sno: structures.length + 1, structure_id: id, item_sub_type: null });
  }

  /**
   * The dyeing hint's data. `items.fabric_type_id`'s validation message names the
   * purpose exactly: "Fabric Type is required (Solid, Yarn-dyed or Melange) — it
   * determines the dyeing PO type." This is the order-level echo of that.
   */
  const fabricTypes: FabricTypeCounts = { solid: 0, yarn_dyed: 0, melange: 0, other: 0 };
  for (const f of fabricRows) {
    const t = (f as { item_sub_type?: string | null }).item_sub_type;
    if (t === "solid" || t === "yarn_dyed" || t === "melange") fabricTypes[t] += 1;
    else fabricTypes.other += 1;
  }

  // ---- Combos, and the structure tree under each one (0408) ----------------
  //
  // A combo is named on both the fabric rows and the pack-ratio lines; the same
  // combo on both is one row, keyed by style + combo. That much is unchanged.
  //
  // WHAT IS NEW IS THE TREE. `order_fabrics` is keyed on (style, combo) and
  // carries MANY rows per combo — which is the order side's own confirmation
  // that a combo has many structures, the fact that corrected 0397. Each of
  // those rows becomes a structure; its `order_fabric_components` become the
  // parts made of it.
  const combos: SeededCombo[] = [];
  const comboByKey = new Map<string, SeededCombo>();
  const comboKeyOf = (refNo: string | null, styleNo: string | null, combo: string) =>
    `${styleKey(refNo, styleNo)}|${combo.toUpperCase()}`;

  for (const r of [...fabricRows, ...packLineRows]) {
    const combo = r.combo?.trim();
    if (!combo) continue;
    const k = comboKeyOf(r.style_ref_no, r.style_no, combo);
    if (comboByKey.has(k)) continue;
    const row: SeededCombo = {
      sno: combos.length + 1,
      ...styleLabel(r.style_ref_no, r.style_no),
      combo,
      // THE ORDER HAS ONE FIELD AND LEGACY SHOWS TWO, filled identically
      // (screenshot 2261: Combo WHITE, ComboDescription WHITE). Copying is a
      // mirror of what the legacy screen displays, not an invention — and the
      // alternative is a column of blanks the operator retypes on every seeded
      // order. It is editable afterwards like everything else the seed writes.
      combo_description: combo,
      structures: [],
    };
    comboByKey.set(k, row);
    combos.push(row);
  }

  /** `order_fabric_components`, grouped under the fabric row they belong to. */
  const componentsByFabric = new Map<string, OrderFabricComponent[]>();
  for (const c of componentRows) {
    const list = componentsByFabric.get(c.order_fabric_id);
    if (list) list.push(c);
    else componentsByFabric.set(c.order_fabric_id, [c]);
  }

  /**
   * THE ORDER'S YARN COLOURS, ROLLED UP FROM THE PART TO THE CLOTH (0480).
   *
   * The two sides state the same fact at different GRAINS.
   * `order_fabric_yarn_colors` hangs off a fabric COMPONENT; the amendment's
   * `yarn_colors` hangs off the STRUCTURE, on the client's own reasoning that a
   * yarn-dyed cloth's yarns are a property of the cloth — every part cut from
   * it is made of the same yarns. So the union of a fabric's parts' yarn
   * colours IS that fabric's yarn colours, and the roll-up loses nothing that
   * the amendment's model says can exist.
   *
   * A UNION, AND THE DE-DUPE IS THE WHOLE POINT. A tee whose front body and
   * back body are both WHITE + BLUE holds four rows on the order side and must
   * seed two colours, not four — the column is a SET and the cell is a tick
   * list, so a repeat would render as one colour offered twice.
   *
   * UPPER-CASED HERE RATHER THAN LEFT AS TYPED, which is one step further than
   * the dyeing seed above takes the same text. The reason is the cell: this is
   * a tick list over `yarnColourOptions`, whose options are already upper-cased,
   * so a seeded "White" would tick nothing and sit beside an untickable WHITE.
   * A free-text colour has no such list to disagree with, which is why the
   * dyeings keep the order's own spelling.
   *
   * GATED ON THE FABRIC'S TYPE — but on a type that CONTRADICTS yarn-dyed,
   * never on one that is merely unanswered. The gate went through both wrong
   * shapes in one afternoon and both are worth stating, because each is the
   * obvious answer to the other's failure.
   *
   * UNGATED WAS THE FIRST CUT, on the argument this file makes everywhere else:
   * the rows exist because somebody entered them on the order, and dropping
   * them because the Type cell beside them is blank would be inventing an
   * absence — the same call `keepUnmatchedMaster` makes for a structure the
   * masters do not know. What makes that insufficient is not the argument but
   * the arithmetic: `writeComboTree` refuses to STORE yarn colours on a fabric
   * positively typed as something else, and the screen clears them when the
   * type moves off Yarn Dyed. An ungated seed would therefore put a value on
   * such a card that nothing shows, nothing edits, and the first save
   * discards — worse than not seeding it, because an absence the operator can
   * see is a prompt while a value that evaporates on save is the shape
   * AGENTS.md records under `created_by`, where the code reads as correct and
   * the value never arrives.
   *
   * STRICT `=== 'yarn_dyed'` WAS THE SECOND CUT AND IT IS WORSE. It reads as
   * the safe answer and it destroys the very data this roll-up exists to carry:
   * `order_fabrics.item_sub_type` is NULLABLE and usually null — every one of
   * the 21 rows in `garment_order_amendment_structures` is null today — so a
   * fabric whose order sheet named its yarn colours and never named its type
   * would be seeded EMPTY, and the seed is the only writer that could ever have
   * supplied them. "NULL is a real state, not a missing default" is the
   * sentence this column already carries in `types.ts`; "not answered" is not
   * "answered something else".
   *
   * SO THE RULE IS THE ASYMMETRIC ONE, STATED ONCE AND OBEYED THREE TIMES —
   * seed, screen, action. It has to be the same asymmetry in all three: a
   * stricter gate anywhere in the chain decides the outcome on its own and
   * turns every looser gate downstream into reasoning about a value that never
   * arrives. READ FROM `f.item_sub_type` UNCHANGED, because that is the value
   * seeded into `item_sub_type` on the same row a few lines down; testing
   * anything else would let the two disagree about the row they both describe.
   */
  const yarnColoursByFabric = new Map<string, string[]>();
  const fabricIdByComponentId = new Map<string, string>();
  for (const c of componentRows) fabricIdByComponentId.set(c.id, c.order_fabric_id);
  for (const y of yarnColors ?? []) {
    const fabricId = fabricIdByComponentId.get(y.fabric_component_id);
    if (!fabricId) continue;
    const name = (y.yarn_dyed_color ?? "").trim().toUpperCase();
    if (!name) continue;
    const list = yarnColoursByFabric.get(fabricId);
    if (!list) yarnColoursByFabric.set(fabricId, [name]);
    else if (!list.includes(name)) list.push(name);
  }

  for (const f of fabricRows) {
    const combo = f.combo?.trim();
    if (!combo) continue;
    const parent = comboByKey.get(comboKeyOf(f.style_ref_no, f.style_no, combo));
    if (!parent) continue;

    /**
     * Structure is resolved by NAME and kept when it misses — the same decision
     * recorded at the top of this file for colours, prints and structures: "a
     * blank picker is a visible prompt, a dropped row is silent data loss". A
     * fabric the order really carries must not vanish from the amendment because
     * its name is spelled differently in the masters.
     *
     * COMPOSITION IS DERIVED, NOT COPIED: what carries over is the structure, and
     * the composition follows from it through the fabric when that category holds
     * exactly one (0430 · 0434). `f.composition` is deliberately left unread —
     * the legacy column holds a PHRASE like "100% BCI COTTON", not a reference,
     * and matching a phrase against a master's names would resolve by coincidence
     * or not at all. That reasoning is untouched by the answer moving back to the
     * `compositions` master.
     *
     * `fabric_type` and `item_sub_type` are NOT resolved at all: both columns
     * carry the same CHECK on both sides (0329 and 0408 share the vocabulary
     * deliberately), so this is a copy, not a translation.
     */
    parent.structures.push({
      sno: parent.structures.length + 1,
      structure_id: categoryByName.get((f.structure_name ?? "").trim().toUpperCase()) ?? null,
      fabric_type: f.fabric_type ?? null,
      composition_id: compositionForStructure(
        categoryByName.get((f.structure_name ?? "").trim().toUpperCase()) ?? null,
        fabricBlends,
        compositionBlends,
      ),
      gsm: f.gsm ?? null,
      /**
       * ±5% WHERE THE ORDER STATED NOTHING (client 2026-08-31), not null.
       *
       * This is the one place in this file where an absent order value becomes
       * a number rather than a blank, so it needs saying why it is not the
       * "plausible wrong default" the Quantities note a few tabs up refuses.
       *
       * A SEED CREATES THESE ROWS. It is row initialisation in exactly the
       * sense `blankStruct()` is on the screen — the difference between a
       * seeded fabric and a hand-added one is only where the structure came
       * from, and ±5% is the standard baseline the client named for a fabric
       * card that is being opened for the first time. Leaving it null would
       * make the same field disagree with itself on one overlay: the order's
       * fabric blank, the fabric added beside it prefilled 5.
       *
       * IT IS A PREFILL, NOT AN ANSWER, and stays fully editable — 3% for a
       * buyer with tighter parameters, 8% for a looser one. `toleranceStated`
       * is what keeps the distinction honest downstream, so a structure whose
       * only content is this number still counts as empty.
       *
       * A STATED 0 SURVIVES. `??` tests for null/undefined, not truthiness, so
       * an order that deliberately allows no variance keeps its 0 rather than
       * being handed a 5 it never asked for.
       */
      gsm_tolerance: f.gsm_tolerance ?? DEFAULT_GSM_TOLERANCE,
      item_sub_type: f.item_sub_type ?? null,
      /* The order's own yarn colours, rolled up from its components — see
         `yarnColoursByFabric` above, which is also where the gate is argued. It
         is repeated here rather than folded into the map because the map is
         keyed by FABRIC and the type is a column of THIS row: a gated map would
         be a second place the same fabric's type was read.

         THE SAME ASYMMETRY `writeComboTree` USES, AND IT MUST BE THE SAME ONE.
         Refuse a type that CONTRADICTS yarn-dyed; never one that is merely
         unanswered. `order_fabrics.item_sub_type` is nullable and usually null
         — all 21 rows in `garment_order_amendment_structures` are null today —
         so a strict `=== "yarn_dyed"` here drops the order's yarn colours
         BEFORE they ever reach the amendment, and the action's deliberate
         permissiveness about null would then be guarding a value nothing had
         handed it. Two gates on one fact must agree, or the stricter one
         decides and the looser one's reasoning is dead code.

         `[]` rather than null for a fabric with none, matching what the column
         reads back as (`not null default '{}'`, 0480), so a seeded row and a
         saved one compare equal in the diff. */
      yarn_colors:
        f.item_sub_type && f.item_sub_type !== "yarn_dyed"
          ? []
          : (yarnColoursByFabric.get(f.id) ?? []),
      components: (componentsByFabric.get(f.id) ?? []).map((c, i) => ({
        sno: i + 1,
        coordinate_id: coordinateByName.get((c.coordinate ?? "").trim().toUpperCase()) ?? null,
        component_id: componentByName.get((c.component ?? "").trim().toUpperCase()) ?? null,
        // TEXT TO TEXT — no resolution, and none possible. 0403 withdrew Colour
        // Cards, so the amendment's own colour is free text too; matching one
        // free-text column against another would be a no-op with extra steps.
        color_name: c.fabric_color ?? null,
        print_id: printByName.get((c.fabric_print ?? "").trim().toUpperCase()) ?? null,
        processed_as_trim: c.processed_as_trim ?? false,
      })),
    });
  }

  // ---- Prices --------------------------------------------------------------
  // `order_prices` is a structural match for the tab: style / article / type /
  // uom / rate. `rate_for_docs` and `mrp_rate` have no amendment column.
  const priceDetails: Seeded<AmendmentPriceDetail>[] = (prices ?? []).map((p, i) => ({
    sno: i + 1,
    ...styleLabel(p.style_ref_no, p.style_no),
    article_no: p.article_no ?? styleLabel(p.style_ref_no, p.style_no).article_no,
    price_type: p.price_type ?? null,
    unit: p.rate_uom ?? null,
    // NULL ON BOTH AXES (0416), and not a gap to fill later: `order_prices` has
    // no colour and no size column, which is the whole reason the amendment side
    // grew them. A seeded price is therefore Style-wise in effect whatever its
    // `price_type` says — and if that type reads Color-wise, `styleRate` refuses
    // and names the style rather than valuing a rate whose colourway is unknown.
    // Guessing the order's only combo here would put an invented colourway on a
    // real rate.
    combo: null,
    size_id: null,
    price: Number(p.rate ?? 0),
  }));

  // ---- Approval Qty + Country/Sizewise -------------------------------------
  // Both come off `order_pack_ratios`: one row per style, its ordered quantity
  // and whether the order carries a country breakdown.
  const approvalQtys: Seeded<AmendmentApprovalQty>[] = [];
  const quantities: SeededQuantity[] = [];
  const countrySizes: Seeded<AmendmentCountrySize>[] = [];
  const seenPackStyle = new Set<string>();
  for (const p of packs ?? []) {
    const key = styleKey(p.style_ref_no, p.style_no);
    if (!key || seenPackStyle.has(key)) continue;
    seenPackStyle.add(key);
    const label = styleLabel(p.style_ref_no, p.style_no);
    /**
     * THE ORDER QUANTITY SEEDS `qty`, NOT `approval_qty` (0413), and this
     * corrects a double-count that was invisible until the column existed.
     *
     * `approval_qty` means "extra pieces for testing, buyer samples and office
     * records" — it is ADDED to the ordered quantity to reach Total Production.
     * Seeding it with `order_qty` therefore counted the whole order twice:
     * Total read PO Qty + Excess + the order again. With a real `qty` column to
     * put it in, the order quantity goes where it belongs and samples start at
     * zero, which is the honest default — nobody has asked for any yet.
     *
     * No combo: `order_pack_ratios` is per STYLE, so the seed cannot know the
     * colour split. The operator adds a row per combo; this one carries the
     * style's total until they do.
     */
    approvalQtys.push({
      sno: approvalQtys.length + 1,
      ...label,
      combo: null,
      combo_description: null,
      /* NO SIZE EITHER (0435). `order_pack_ratios` is per STYLE, so the seed
         knows neither the colour split nor the size split. The row carries the
         style total until the operator enters the Quantities assortment, at
         which point the tab derives its own rows and this one shows as a
         legacy line rather than disappearing. */
      size_id: null,
      qty: Number(p.order_qty ?? 0),
      approval_qty: 0,
    });
    countrySizes.push({
      sno: countrySizes.length + 1,
      ...label,
      countrywise: !!p.country_code?.trim(),
    });
    quantities.push({
      sno: quantities.length + 1,
      country_id: null,
      /* NO PACKING METHOD EITHER (0473), and for the same reason as the size
         above: an order declares no pack types at all, so there is nothing to
         seed. The operator names one on the Quantities row once Pack type(s)
         has been filled in. */
      pack_type: null,
      style_ref_no: p.style_ref_no,
      // `styleLabel` names its column `style`; this table's is `style_no`,
      // matching the order children it is keyed against.
      style_no: p.style_no,
      consignee_id: null,
      assortment_type_id: null,
      /* NOT seeded from the order's PO number (0427). Per-line PO numbers are
         what Multi Order collects; copying the header's down into every seeded
         line would invent three identical answers and then be indistinguishable
         from three the operator typed. Same reasoning as the assortment below. */
      po_no: null,
      po_qty: Number(p.order_qty ?? 0),
      delivery_date: null,
      earlier_shipment_date: null,
      warehouse_id: null,
      discharge_port_id: null,
      /**
       * THE ASSORTMENT IS NOT SEEDED (0414), and this is not a gap to close
       * later without asking.
       *
       * `order_pack_ratio_lines` DOES carry the carton and size matrix — but
       * positionally, `size1_qty … size16_qty`, with
       * `order_pack_ratio_size_labels` supposed to say what position N means.
       * That label table has zero readers and zero writers in this codebase and
       * holds no rows, and the one screen that writes ratios hardcodes eight
       * labels of its own. So there is no live source of truth for what
       * position 3 IS, and mapping the numbers across would attach quantities
       * to sizes by guesswork — on a document that tells a factory what to cut.
       *
       * An empty assortment the operator fills in is honest; a mis-sized one
       * is not. `is_ratio_wise_pack` / `is_single_style_pack` take their column
       * defaults rather than being guessed from `order_pack_ratios`, for the
       * same reason country and consignee are left null above.
       */
      pack: null,
      is_ratio_wise_pack: false,
      ratio_for: null,
      is_single_style_pack: false,
      master_carton_name: null,
      inner_carton_name: null,
      pack_description: null,
      assort_lines: [],
    });
  }

  return { styles, dyeings, prints, structures, combos, priceDetails, approvalQtys, quantities, countrySizes, fabricTypes };
}
