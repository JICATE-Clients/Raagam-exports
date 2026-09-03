import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import {
  bomTaskRows,
  confirmedOrdersForBom,
  getOrderProduction,
  rejectionTiersById,
  type BomLite,
  type BomTaskRow,
} from "@/lib/orders/bom-order-basis";
import { FABRIC_CLASS_CODE, type FabricOption } from "./fabric-options";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { FabricProcessLookups, FabricProcessOption } from "./processes";
import type { FabricComposition, YarnProcessOption } from "./yarn-process";
import type { FabricBom, OrderFabricSeedRow, OrderPalette } from "./types";
import type { StyleComponentDecl } from "./component-map";

export { getOrderProduction };
export type { BomTaskRow };

// ---------------------------------------------------------------------------
// The work queue
// ---------------------------------------------------------------------------

/**
 * One row per confirmed garment ORDER, with the state of its fabric BOM.
 *
 * The status vocabulary, the freshness pairing and the sort are all
 * `bom-order-basis.ts`'s — shared with Material BOM rather than restated, so the
 * two queues cannot come to disagree about what "Recalculate" means. What is
 * local is the query, because the BOM table and its line child differ.
 */
export async function listFabricBomTasks(): Promise<BomTaskRow[]> {
  const s = await createClient();

  const [tiers, orders, bomsRes] = await Promise.all([
    rejectionTiersById(),
    confirmedOrdersForBom(),
    s
      .from("order_fabric_boms")
      .select(
        "id, code, garment_order_id, is_draft, computed_basis_hash, computed_for_qty, " +
          "lines:order_fabric_bom_lines(id)",
      ),
  ]);

  type BomRow = {
    id: string;
    code: string | null;
    garment_order_id: string;
    is_draft: boolean;
    computed_basis_hash: string | null;
    computed_for_qty: number | null;
    lines: { id: string }[] | null;
  };

  // NO "latest wins" pass here, unlike Material BOM. `uq_order_fabric_bom_order`
  // (0426) makes one-per-order a constraint rather than a convention, so a
  // second row cannot exist to be chosen between — and a Map keyed on the order
  // is exactly as strong as the index.
  const byOrder = new Map<string, BomLite>();
  for (const b of (bomsRes.data ?? []) as unknown as BomRow[]) {
    byOrder.set(b.garment_order_id, {
      id: b.id,
      code: b.code,
      is_draft: b.is_draft,
      computed_basis_hash: b.computed_basis_hash,
      computed_for_qty: b.computed_for_qty,
      lineCount: b.lines?.length ?? 0,
    });
  }

  return withCreators(bomTaskRows(orders, tiers, byOrder));
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

/** All fabric BOMs with their order and child grids. */
export async function listFabricBoms(): Promise<FabricBom[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_fabric_boms")
    .select(
      "*, garment_order:garment_order_amendments(id, code, po_no, amend_date, delivery_date, " +
        "excess_pct, rejection_rule_id, customer:customers(id,code,name), " +
        "sales_order:sales_orders(id,order_number)), " +
        "lines:order_fabric_bom_lines(*), " +
        /* THE MANUAL ENTRIES, with their components and sizes nested (0494).
           A TOP-LEVEL CHILD, unlike 0491's size rows which hung off a line: an
           entry groups several components at one combined weight, so it belongs
           to the BOM and not to any one line. Its own children nest because they
           are keyed on `entry_id` and there is no way to fetch them beside the
           entries and re-associate them without repeating this join. */
        "manualEntries:order_fabric_bom_manual_entries(*, " +
        "components:order_fabric_bom_manual_components(*), " +
        "sizes:order_fabric_bom_manual_sizes(*)), " +
        "requirements:order_fabric_bom_requirements(*), " +
        "dias:order_fabric_bom_dias(*), " +
        /* THE ROUTE ROWS (0492), embedded FLAT under the header rather than
           under their line — the shape `requirements` above already takes, and
           for the same reason: one select, and one delete per table in
           `writeLines`. The screen re-associates them by `line_id` while it maps
           the lines onto fresh keys. */
        "processes:order_fabric_bom_processes(*), " +
        /* THE YARN ROWS AND THEIR TREATMENTS (0493 · 0504). Nested, because a
           stage hangs off a yarn row that exists nowhere else — there is
           nothing to re-associate them by if they are fetched apart from it.
           The same shape a line's Manual sizes take, and for the same reason. */
        "yarns:order_fabric_bom_yarns(*, stages:order_fabric_bom_yarn_stages(*)), " +
        /* YARN DYED DETAILS (0512) — the [Detail] overlay's two TYPED panels,
           flat under the header like `dias` and for the same reason: they are
           addressed by the fabric GROUP they describe, by value, and reference
           no line. Mixing Details is absent because it is DERIVED — see
           `mixingDetailRows` in yarn-dyed.ts. */
        "ydRepeats:order_fabric_bom_yd_repeats(*), " +
        "ydCombinations:order_fabric_bom_yd_combinations(*)",
    )
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as FabricBom[]).map((r) => ({
      ...r,
      lines: [...(r.lines ?? [])].sort((a, b) => a.sno - b.sno),
      /* THE GRANDCHILDREN ARE SORTED TOO, for the reason stated below. A size
         row is read back by matching `size_id`, so an out-of-order embed cannot
         put a weight on the wrong size — but `sno` is what the grid renumbers
         from, and an unsorted read would have the sizes change places every time
         the document is reopened. The components carry no sno and are a SET, so
         they are left as they come. */
      manualEntries: [...(r.manualEntries ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((e) => ({
          ...e,
          components: e.components ?? [],
          sizes: [...(e.sizes ?? [])].sort((a, b) => a.sno - b.sno),
        })),
      requirements: [...(r.requirements ?? [])].sort((a, b) => a.sno - b.sno),
      /* SORTED HERE, NOT ORDERED IN THE QUERY. PostgREST makes no ordering
         promise for an embedded child, which is the same trap the combo tree
         records: a mis-ordered pair puts one fabric's GSM on another's row. */
      dias: [...(r.dias ?? [])].sort((a, b) => a.sno - b.sno),
      /* Sorted for the reason stated above, and here it decides the ROUTE's
         order — knitting before dyeing. An unsorted embed does not look broken,
         it looks like a route somebody entered backwards. */
      processes: [...(r.processes ?? [])].sort((a, b) => a.sno - b.sno),
      /* BOTH LEVELS SORTED. The parent matters least — the screen re-derives
         the yarn order from the compositions and sorts by NAME — but the STAGES'
         order is the planner's own sequence, and an unsorted read would show a
         yarn dyed after it was wound. */
      yarns: [...(r.yarns ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((y) => ({
          ...y,
          stages: [...(y.stages ?? [])].sort((a, b) => a.sno - b.sno),
        })),
    })),
  );
}

// ---------------------------------------------------------------------------
// The seed: the order's own fabric tree, flattened
// ---------------------------------------------------------------------------

/**
 * Every (combo, structure, component) leaf of one order's Combos tab.
 *
 * THIS IS THE WHOLE "SEEDS FROM THE ORDER" CLAIM, made concrete. The operator
 * has already told the order which structures each colourway uses and which
 * panels are cut from each — 0408's three-level tree — so asking them to retype
 * it as BOM lines is asking them to disagree with themselves.
 *
 * IT DOES NOT CARRY GSM, COMPOSITION OR SOLID/MELANGE ONTO THE LINE. Those come
 * back for DISPLAY only: a copy on the BOM line is a second place for them to
 * disagree with the order, and the order is the one that is right.
 *
 * THAT DISPLAY IS NOW TWO COLUMNS, not just a seeding aid. Legacy's
 * FabricAllocation tab prints `GSM Range` and `Type` (Solid / Melange / Yarn
 * Dyed) beside the fabric (client screenshot 2581, 2026-09-01), and the screen
 * renders both by looking a line up in these rows — read-only, derived, never
 * stored. `gsm_tolerance` is selected for exactly that: legacy prints a RANGE
 * ("175 - 185"), and `gsm` alone cannot produce one.
 *
 * The names are resolved here rather than on the screen because the screen has
 * the structure and component PICKER lists, which are the masters — and a
 * structure the order names but the master has since deactivated would resolve
 * to nothing there, silently turning a seeded row into an unlabelled one.
 */
export async function getOrderFabricSeed(
  garmentOrderId: string,
): Promise<OrderFabricSeedRow[]> {
  const s = await createClient();

  const { data } = await s
    .from("garment_order_amendment_combos")
    .select(
      "style_ref_no, style, article_no, combo, " +
        "structures:garment_order_amendment_combo_structures(" +
        "structure_id, fabric_type, item_sub_type, gsm, gsm_tolerance, " +
        "components:garment_order_amendment_combo_components(coordinate_id, component_id, color_name, print_id))",
    )
    .eq("amendment_id", garmentOrderId)
    .order("sno");

  type ComboRow = {
    style_ref_no: string | null;
    style: string | null;
    article_no: string | null;
    combo: string | null;
    structures:
      | {
          structure_id: string | null;
          fabric_type: string | null;
          item_sub_type: string | null;
          gsm: number | null;
          gsm_tolerance: number | null;
          components:
            | {
                coordinate_id: string | null;
                component_id: string | null;
                color_name: string | null;
                print_id: string | null;
              }[]
            | null;
        }[]
      | null;
  };

  const rows = (data ?? []) as unknown as ComboRow[];

  const structureIds = new Set<string>();
  const componentIds = new Set<string>();
  const printIds = new Set<string>();
  for (const c of rows) {
    for (const st of c.structures ?? []) {
      if (st.structure_id) structureIds.add(st.structure_id);
      for (const cp of st.components ?? []) {
        if (cp.component_id) componentIds.add(cp.component_id);
        if (cp.print_id) printIds.add(cp.print_id);
      }
    }
  }

  const [structureNames, componentNames, printNames] = await Promise.all([
    nameMap("categories", [...structureIds]),
    nameMap("components", [...componentIds], "short_name"),
    /* THE ROLL FORM PRINT, resolved beside the other two (client 2026-09-02).
       Only the ids that actually appear, never the whole lookup table — the same
       call `getStructureRows` makes for the knit family. */
    nameMap("config_lookups", [...printIds]),
  ]);

  const out: OrderFabricSeedRow[] = [];
  for (const c of rows) {
    for (const st of c.structures ?? []) {
      const parts = st.components ?? [];
      // A STRUCTURE WITH NO COMPONENTS STILL SEEDS ONE ROW. The nested grid is
      // optional on the order — a body fabric named with no panel breakdown is
      // an ordinary state — and dropping it here would silently leave the
      // largest fabric on the order out of its own BOM.
      const leaves =
        parts.length > 0
          ? parts
          : [{ coordinate_id: null, component_id: null, color_name: null, print_id: null }];
      for (const cp of leaves) {
        out.push({
          style_ref_no: c.style_ref_no,
          style: c.style,
          article_no: c.article_no,
          combo: c.combo,
          structure_id: st.structure_id,
          structure_name: st.structure_id ? (structureNames.get(st.structure_id) ?? null) : null,
          /* THE COORDINATE TRAVELS WITH THE COMPONENT (0495).
             The Style declares the PAIR (FRONT BODY *of* PIECES) and the order
             stores both, so a reader of this tree that carries one and drops the
             other is holding half a panel's identity.

             IT FIXES NO LIVE BUG TODAY, and saying so is the point. It was added
             for the seeded-line path — a line arriving with a panel and no
             coordinate would show "—" in the Components sheet — and "Seed from
             order" was removed from the UI hours earlier, on 2026-09-01, at the
             client's instruction. Nothing creates rows from these any more:
             `descriptorFor` reads them for GSM Range and Type, `orderStructures`
             to scope the Structure picker. The two live paths both fill the
             coordinate correctly without this (a saved line loads it from the
             column; `availablePanels` sets it from the chosen panel), so this
             completes the TYPE rather than repairing a screen.

             Kept rather than reverted because the tuple being complete is what
             makes the next reader's join correct by construction — and because
             the seed button is a client decision that has been reversed before
             on this screen. If it never returns, this costs one column in one
             select. */
          coordinate_id: cp.coordinate_id,
          component_id: cp.component_id,
          component_name: cp.component_id ? (componentNames.get(cp.component_id) ?? null) : null,
          print_name: cp.print_id ? (printNames.get(cp.print_id) ?? null) : null,
          fabric_type: st.fabric_type,
          // The COMPONENT's fabric colour where it has one, falling back to the
          // colourway's own name. A component colour is a contrast panel; with
          // none, the panel is the garment's colour, which is what `combo` says.
          color_name: cp.color_name ?? c.combo,
          item_sub_type: st.item_sub_type,
          gsm: st.gsm,
          gsm_tolerance: st.gsm_tolerance,
        });
      }
    }
  }
  return out;
}

/** id -> name for a master, in one round trip. Deactivated rows INCLUDED: this
 *  labels what the order already holds, and a blank label on a real row is the
 *  "Disabled rows" failure read from the display side. */
/**
 * id → display name for a master, in one round trip.
 *
 * THE NAME COLUMN IS A PARAMETER BECAUSE IT IS NOT ALWAYS `name`. `components`
 * has `short_name` and no `name` at all (0228), and PostgREST answers a select
 * over a missing column with an ERROR rather than nulls — so a hard-coded
 * `"name"` here returns nothing and every seeded row loses its label, which
 * reads as "the order named no panels" rather than as a fault.
 *
 * Deactivated rows are INCLUDED: this labels what a document already holds, and
 * a blank label on a real row is the "Disabled rows" failure read from the
 * display side.
 */
async function nameMap(
  table: string,
  ids: string[],
  nameColumn: "name" | "short_name" = "name",
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const s = await createClient();
  const { data } = await s.from(table).select(`id, ${nameColumn}`).in("id", ids);
  return new Map(
    ((data ?? []) as Record<string, string>[])
      .filter((r) => r[nameColumn])
      .map((r) => [r.id, r[nameColumn]]),
  );
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

export type PickerRow = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  /**
   * A STRUCTURE'S KNIT FAMILY — "Circular Knit" — and null on every other kind of
   * picker row (2026-09-02).
   *
   * OPTIONAL RATHER THAN A SECOND ROW TYPE, because `PickerRow` is what four
   * lists on this screen already are and splitting it would mean a cast at every
   * call site that does not care. Only `getStructureRows` sets it; Components
   * prints it as legacy's `Structure Type`.
   */
  knit?: string | null;
};
export type UomRow = PickerRow & { decimal_places_allowed: number | null };

/** The garment orders a BOM may be raised against — the same confirmed set the
 *  queue lists, shaped for a picker. */
/** One style of the order, as the Manual tab's header row shows it (0495). */
export type FabricBomStyleRow = {
  style_ref_no: string;
  /** The Style master's own code — legacy's "StyleNo". NULL where the order
   *  names a style by ref only, which 0457 made an ordinary state. */
  style_no: string | null;
  article_no: string | null;
  /** 'pcs' | 'sets' (0471) — legacy's "Component Unit". */
  unit_kind: string | null;
};

export type FabricBomOrderOption = PickerRow & {
  customer_name: string | null;
  delivery_date: string | null;
  /** The style refs the order declares, for the line's Style cell. */
  styles: string[];
  /**
   * The same styles WITH THEIR IDENTITY — the Manual tab's header level (0495).
   *
   * The client's spec asks that tab to show S No / StyleRefNo / StyleNo /
   * ArticleNo read-only, and `garment_order_amendment_styles` already carries
   * every one of them. Returned BESIDE `styles` rather than replacing it: that
   * array feeds a `<Select>` of plain strings on the Fabric Lines grid, and
   * widening it would make two screens change for one screen's need.
   *
   * NOTHING HERE IS STORED ON THE BOM. Same call 0426 makes for the seed and
   * 0490 for the palette — a copy is a second place to disagree with the order.
   */
  styleRows: FabricBomStyleRow[];
  /** The colourways it declares, for the line's Combo cell. */
  combos: string[];
  /**
   * 'pcs' | 'sets' — the ORDER UNIT, for the read-only Uom cell (client spec,
   * 2026-09-01: "It should default to Pcs (Pieces) based on the Order Unit
   * setup… If the order unit is Sets, the system handles it based on set
   * parameters").
   *
   * `styles[].unit_kind` (0471) already rides in on `ORDER_SELECT` for the
   * Manual tab, so this needed no widening of a query shared with Material BOM.
   *
   * NULL WHERE THE STYLES DISAGREE, the abstention every derivation on this
   * screen makes. It is stated per STYLE, so a two-style order can legitimately
   * mix Pcs and Sets and there is no single answer to print.
   */
  unit_kind: string | null;
};

async function getOrderOptions(): Promise<FabricBomOrderOption[]> {
  const orders = await confirmedOrdersForBom();
  return orders.map((o) => ({
    id: o.id,
    // The SC No is what an operator calls an order; the internal code is the
    // fallback, never the other way round (0395 stamps the SC No on the shell).
    code: o.sales_order?.order_number ?? o.code,
    name: [o.sales_order?.order_number ?? o.code, o.po_no, o.customer?.name]
      .filter(Boolean)
      .join(" · "),
    inactive: false,
    customer_name: o.customer?.name ?? null,
    delivery_date: o.delivery_date,
    styles: [...new Set((o.styles ?? []).map((s) => s.style_ref_no).filter(Boolean))] as string[],
    /* ONE ROW PER STYLE THE ORDER NAMES, deduped by ref for `styles`' reason —
       the amendment can legitimately carry the same ref twice across its own
       children, and the Manual tab's header must not then show it twice.
       FIRST WINS rather than merged: two rows sharing a ref are one style, and
       picking a field from each would compose an identity that exists nowhere. */
    styleRows: (() => {
      const seen = new Map<string, FabricBomStyleRow>();
      for (const st of o.styles ?? []) {
        const ref = (st.style_ref_no ?? "").trim();
        if (!ref || seen.has(ref)) continue;
        seen.set(ref, {
          style_ref_no: ref,
          style_no: st.style?.code ?? null,
          article_no: st.article_no ?? null,
          unit_kind: st.unit_kind ?? null,
        });
      }
      return [...seen.values()];
    })(),
    combos: [...new Set((o.combos ?? []).map((c) => c.combo).filter(Boolean))] as string[],
    unit_kind: (() => {
      const kinds = new Set(
        (o.styles ?? []).map((x) => (x.unit_kind ?? "").trim().toLowerCase()).filter(Boolean),
      );
      return kinds.size === 1 ? [...kinds][0] : null;
    })(),
  }));
}

/**
 * Item class code by id.
 *
 * AN ITEM CLASS IS A `config_lookups` ROW OF KIND `item_class` — there is no
 * `item_classes` table, and asking PostgREST to embed one does not fail
 * politely: an unresolvable relationship name fails the WHOLE query, so a single
 * wrong embed here would blank every option list on the screen at once. Two
 * round trips and a Map is what `getMaterialRows` does one module along, for
 * exactly this reason.
 */
async function itemClassCodes(): Promise<Map<string, string | null>> {
  const s = await createClient();
  const { data } = await s.from("config_lookups").select("id, code").eq("kind", "item_class");
  return new Map(((data ?? []) as { id: string; code: string | null }[]).map((c) => [c.id, c.code]));
}

const isFabricClassId = (
  classes: Map<string, string | null>,
  id: string | null,
): boolean => (id ? (classes.get(id) ?? "")?.toUpperCase() === FABRIC_CLASS_CODE : false);

/**
 * The fabrics a line may name.
 *
 * NARROWED TO THE FABRIC CLASS HERE, matching `getMaterialRows`'s call one
 * module along: shipping every item in the database to the browser to filter it
 * there is a payload, not a rule. What must NOT be narrowed away is a
 * DEACTIVATED fabric — `inactive` is carried, never filtered, so the row a saved
 * line already holds still resolves (AGENTS.md, Disabled rows); the picker greys
 * it and refuses to re-pick it.
 */
async function getFabricRows(): Promise<FabricOption[]> {
  const s = await createClient();
  const [itemsRes, classes] = await Promise.all([
    s
      .from("items")
      /* `fabric_type` EMBEDDED RATHER THAN RESOLVED IN A SECOND PASS. It is a
         plain FK to `config_lookups`, readable by everyone, so PostgREST can
         name it in one round trip — unlike `created_by`, where `profiles_read_own`
         is what forces the `creator_names()` RPC (AGENTS.md, Created Date). */
      .select(
        /* `base_uom_id` FEEDS `consumption_uom_id` (0513). The Mixing Uom cell
           became the client's percent/cm ratio unit, so the unit the
           consumption figure is in has no cell of its own any more and is
           auto-filled from the fabric master when a fabric is picked. Safe
           because it is SET: all 14 live fabrics carry one (2026-09-02). */
        /* `category_id` IS THE STRUCTURE, and it is what scopes the Fabric cell
           to the row's Structure (client 2026-09-02). See `FabricOption`. */
        "id, code, name, is_active, item_class_id, category_id, base_uom_id, " +
          "fabric_type:config_lookups!fabric_type_id(name)",
      )
      .order("name"),
    itemClassCodes(),
  ]);

  /**
   * THE EMBED COMES BACK AS AN OBJECT OR AN ARRAY, AND THIS MUST SURVIVE BOTH.
   *
   * PostgREST returns a many-to-one embed as an object, but the generated types
   * describe it as an array and a `.single()`-less select can hand back either
   * depending on how the relationship is resolved. This code previously CAST the
   * object shape (`as unknown as { fabric_type: { name } | null }`) and read
   * `r.fabric_type?.name`, which on the array shape is `undefined` for every row.
   *
   * THAT IS NOT A COSMETIC RISK. `fabric_type` decides whether a line is yarn
   * dyed, and since 0513 that decides whether Mixing Uom and No Of Colors exist
   * at all and whether [Detail] opens. A silent null here does not show a wrong
   * value — it disables a whole feature and leaves the `Type` column reading
   * "—" on every row, which is indistinguishable from "the master has no type".
   * A cast that lies costs nothing until the shape it asserts is wrong.
   */
  const embeddedName = (
    v: { name: string | null } | { name: string | null }[] | null | undefined,
  ): string | null => (Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null));

  return ((itemsRes.data ?? []) as unknown as {
    id: string;
    code: string | null;
    name: string;
    is_active: boolean;
    item_class_id: string | null;
    category_id: string | null;
    base_uom_id: string | null;
    fabric_type: { name: string | null } | { name: string | null }[] | null;
  }[])
    .filter((r) => isFabricClassId(classes, r.item_class_id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      class_code: FABRIC_CLASS_CODE,
      category_id: r.category_id,
      base_uom_id: r.base_uom_id,
      fabric_type: embeddedName(r.fabric_type),
      inactive: isInactive(r),
    }));
}

/** Fabric structures — `categories` of the FABRIC item class, which is where
 *  0409 moved the ORDER's own structure column, so the two lists agree.
 *
 *  ## IT NOW CARRIES THE KNIT FAMILY TOO (client 2026-09-02)
 *
 *  Components prints legacy's `Structure Type` — "Circular" — beside the
 *  structure, and `categories.fabric_structure_id` is where that lives: a
 *  `config_lookups` row whose codes are `circular` / `flat_knit` / `woven`, the
 *  same vocabulary `isCircularKnit` reads and the same one Combos ▸ [Detail]
 *  derives its family chip from. All three structures in use resolve to Circular
 *  Knit, which is exactly what the legacy screen prints.
 *
 *  IT IS A PROPERTY OF THE STRUCTURE, NOT OF THE ORDER, and that is why it rides
 *  here rather than on the seed. This column was reported ABSENT once — the
 *  search stopped at `order_fabric_bom_dias.knit_type` (a property of a DIA) and
 *  at `combo_structures.fabric_type`, which is NULL on all 33 live rows. Neither
 *  is it. Look on the master before concluding a value has no source. */
async function getStructureRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const [catRes, classes] = await Promise.all([
    /* NO EMBED FOR THE KNIT FAMILY, and both attempts are worth recording so
       the next reader does not repeat them. `config_lookups!fabric_structure_id(name)`
       and the constraint-named form BOTH typed as `GenericStringError[]` —
       Supabase's way of saying the select string did not parse against the
       generated types, which is a runtime failure and not merely a typing one.
       The cast then reports it three lines down as a mismatch on `catRes.data`,
       which reads like a cast problem and is not.

       So the lookup is a second query, joined here — the same shape
       `getRequirementSheet` uses for its name maps, on a list fetched once per
       screen. */
    s
      .from("categories")
      .select("id, short_name, name, inactive, item_class_id, fabric_structure_id")
      .order("name"),
    itemClassCodes(),
  ]);

  const cats = (catRes.data ?? []) as {
    id: string;
    short_name: string | null;
    name: string | null;
    inactive: boolean;
    item_class_id: string | null;
    fabric_structure_id: string | null;
  }[];

  /* ONLY THE IDS THAT ACTUALLY APPEAR, never the whole lookup table. */
  const knitIds = [...new Set(cats.map((r) => r.fabric_structure_id).filter(Boolean))] as string[];
  const knitRes = knitIds.length
    ? await s.from("config_lookups").select("id, name").in("id", knitIds)
    : { data: [] as { id: string; name: string | null }[] };
  const knitById = new Map(
    ((knitRes.data ?? []) as { id: string; name: string | null }[]).map((r) => [r.id, r.name]),
  );

  return cats
    .filter((r) => isFabricClassId(classes, r.item_class_id))
    // `name` is NULLABLE on this table, so a category saved with only a short
    // name would otherwise render as a blank option the operator cannot tell
    // apart from the next blank one.
    .map((r) => ({
      id: r.id,
      code: r.short_name,
      name: r.name ?? r.short_name ?? "(unnamed)",
      inactive: isInactive(r),
      /* THE KNIT FAMILY, on the picker row rather than in a second map. It rides
         with the structure everywhere the structure goes, so a screen that has
         the row already has the answer — see `PickerRow.knit`. */
      knit: r.fabric_structure_id ? (knitById.get(r.fabric_structure_id) ?? null) : null,
    }));
}

/**
 * The garment panels a fabric may be cut for.
 *
 * `inactive`, NOT `is_active`. The schema spells the disable flag three ways and
 * `components` was renamed to `inactive` by 0299 — the exact column
 * `lib/masters/inactive.ts` records getting wrong once already: PostgREST answers
 * a select over a MISSING column with an ERROR rather than nulls, so the query
 * returns no data and the dropdown is silently EMPTY on every row. Last time it
 * was this table, and the Style screen's Component picker was blank for weeks.
 * Read the column from the catalog, never from memory.
 */
async function getComponentRows(): Promise<PickerRow[]> {
  const s = await createClient();
  // `short_name` IS the component's name — the table has no `name` column and
  // no `code` (0228, and the client had the description field dropped: "maintain
  // only name"). Selecting either is the same silent-empty failure as the flag.
  const { data } = await s.from("components").select("id, short_name, inactive").order("short_name");
  return ((data ?? []) as { id: string; short_name: string; inactive: boolean }[]).map((r) => ({
    id: r.id,
    code: null,
    name: r.short_name,
    inactive: isInactive(r),
  }));
}

async function getUomRows(): Promise<UomRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name, decimal_places_allowed, is_active")
    .order("name");
  return ((data ?? []) as (Omit<UomRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    ...r,
    inactive: isInactive(r),
  }));
}

/**
 * The Process master, WHOLE, with the one flag the Fabric Process tab reads.
 *
 * NOT `.eq("for_fabric", true)`, and that is the "Disabled rows" rule rather
 * than an oversight (AGENTS.md): a process whose Fabric flag is unticked on the
 * master AFTER a BOM named it must stay resolvable on the row that holds it, or
 * a filled cell renders as empty and the next save blanks the FK. The narrowing
 * runs in the browser, per row, in `processesForFabric` — which re-admits the
 * held value after the filter rather than before it.
 *
 * `getProcessRows` in `lib/orders/amendments/service.ts` returns the same master
 * the same way, for the same reason, one tab over.
 */
async function getFabricProcessRows(): Promise<FabricProcessOption[]> {
  const s = await createClient();
  // `inactive`, not `is_active` — 0227's spelling. Reading the flag column from
  // memory is what leaves a picker silently empty, since PostgREST answers a
  // select over a MISSING column with an error rather than nulls.
  const { data } = await s
    .from("processes")
    .select("id, name, inactive, for_fabric")
    .order("name");
  return ((data ?? []) as {
    id: string;
    name: string;
    inactive: boolean | null;
    for_fabric: boolean | null;
  }[]).map((p) => ({
    id: p.id,
    code: null,
    name: p.name,
    inactive: p.inactive ?? false,
    for_fabric: p.for_fabric ?? false,
  }));
}

/**
 * The three operator-filled ▾ lists behind Stage, Loss for and Type (0492).
 *
 * ONE QUERY FOR THREE KINDS, split in memory. Three round trips for three short
 * lists on one grid is the cost the `.in()` avoids, and the split cannot drift:
 * the kinds are named once, here, and `LookupDialogPicker` is handed each list
 * whole (it hides an inactive row itself, and keeps the one a record holds).
 */
async function getFabricProcessLookupRows(): Promise<FabricProcessLookups> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, kind, code, name, notes, is_active")
    .in("kind", ["fabric_stage", "process_loss_for", "fabric_process_type"])
    .order("name");
  const rows = (data ?? []) as unknown as ConfigLookup[];
  return {
    stages: rows.filter((r) => r.kind === "fabric_stage"),
    lossFor: rows.filter((r) => r.kind === "process_loss_for"),
    types: rows.filter((r) => r.kind === "fabric_process_type"),
  };
}

/**
 * The processes a YARN route may name (0493) — the master, unfiltered.
 *
 * A SECOND READ OF `processes`, beside `getFabricProcessRows` above, and it is
 * worth saying why rather than leaving it to look like an oversight: the two
 * tabs read DIFFERENT applicability flags, the two option types are declared in
 * their own client-safe files, and both run inside one `Promise.all`. Whoever
 * next touches both is welcome to merge them into a single select carrying both
 * flags; until then two short queries in parallel cost less than a shared type
 * that neither file owns.
 *
 * `inactive`, not `is_active` — 0227's spelling. Reading the flag column from
 * memory is what leaves a picker silently empty, since PostgREST answers a
 * select over a MISSING column with an error rather than nulls.
 */
async function getYarnProcessRows(): Promise<YarnProcessOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, inactive, for_yarn")
    .order("name");
  return ((data ?? []) as {
    id: string;
    name: string;
    inactive: boolean | null;
    for_yarn: boolean | null;
  }[]).map((p) => ({
    id: p.id,
    code: null,
    name: p.name,
    inactive: p.inactive ?? false,
    for_yarn: p.for_yarn ?? false,
  }));
}


/**
 * Coordinates — `items` of class GAR (0396), for the Components sheet's
 * read-only Coordinate cell (0495).
 *
 * THE SAME NARROWING `getCoordinateRows` DOES ONE MODULE ALONG, and done here
 * for the same stated reason: "the cascading-picker rule puts the narrowing at
 * the layer that knows the class, and an item named PIECES in some other class
 * would otherwise be offered and be wrong."
 *
 * `inactive` RIDES ALONG rather than being filtered in SQL. This list only
 * LABELS a coordinate the line already holds — the cell is read-only, filled
 * from the chosen panel — so filtering a switched-off row out would blank the
 * label on a real value and read as "no coordinate" rather than as a retired
 * one ("Disabled rows", read from the display side).
 */
async function getCoordinateRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const [itemsRes, classes] = await Promise.all([
    s.from("items").select("id, code, name, is_active, item_class_id").order("name"),
    itemClassCodes(),
  ]);
  return ((itemsRes.data ?? []) as {
    id: string;
    code: string | null;
    name: string;
    is_active: boolean;
    item_class_id: string | null;
  }[])
    .filter(
      (r) =>
        !!r.item_class_id && (classes.get(r.item_class_id) ?? "").toUpperCase() === "GAR",
    )
    .map((r) => ({ id: r.id, code: r.code, name: r.name, inactive: isInactive(r) }));
}

/**
 * The Stage ▾ behind a yarn's process (0504).
 *
 * STILL ONE KIND, AND FOR A DIFFERENT REASON SINCE 0520. It read "0493's flat
 * tab also fetched `process_loss_for`; 0504's does not, because its `For` column
 * names a COLOURWAY" — and on 2026-09-03 that column became the
 * `process_loss_for` lookup after all. It is not fetched HERE because the fabric
 * route already loads it (`processLookups.lossFor`) and the Yarn Process grid is
 * handed that same list: one query, one list, both `For` columns. Fetching it
 * twice would be two arrays of the same rows, and the second one is what goes
 * stale after a "+ Add" on the other tab.
 */
/**
 * WHAT "+ Add" ON THE FABRIC CELL NEEDS (client 2026-09-02, "with the crud
 * action") — the three lists `FabricQuickCreateSheet` cannot compose a savable
 * fabric without.
 *
 * ONE FUNCTION, ONE ROUND OF QUERIES, because all three are the same feature and
 * a partial answer is a sheet that opens and cannot save. `createMaterial`
 * demands `item_class_id` + `fabric_type_id` + `category_id` + `base_uom_id`
 * and then a yarn composition on top, so a missing class id or an empty yarn
 * list is not a degraded Add — it is an Add that can only ever produce an error.
 * The uoms it also needs are already on `FabricBomFormData`.
 *
 * `fabricClassId` IS NULL-ABLE ON PURPOSE. It is a `config_lookups` row and this
 * function does not create it; the screen hides the Add affordance rather than
 * offering one whose Save the server will refuse for a field the sheet cannot
 * show.
 */
export type FabricCreateFeed = {
  /** config_lookups id of item class FABRIC. Null if the class row is missing. */
  fabricClassId: string | null;
  /** config_lookups kind `fabric_type` — Solid · Melange · Yarn Dyed. */
  fabricTypes: ConfigLookup[];
  /** The YARN master, whole, for the composition grid. `inactive` carried and
   *  never filtered — the picker greys a disabled yarn rather than hiding a row
   *  an existing composition may already name (AGENTS.md, Disabled rows). */
  yarns: PickerRow[];
};

async function getFabricCreateFeed(): Promise<FabricCreateFeed> {
  const s = await createClient();
  const [classRes, typeRes, yarnRes] = await Promise.all([
    s.from("config_lookups").select("id, code").eq("kind", "item_class"),
    s
      .from("config_lookups")
      .select("id, kind, code, name, notes, is_active")
      .eq("kind", "fabric_type")
      .order("name"),
    s.from("items").select("id, code, name, is_active, item_class_id").order("name"),
  ]);

  const classes = new Map(
    ((classRes.data ?? []) as { id: string; code: string | null }[]).map((c) => [c.id, c.code]),
  );
  const yarnClassId =
    [...classes.entries()].find(([, code]) => (code ?? "").toUpperCase() === "YARN")?.[0] ?? null;
  const fabricClassId =
    [...classes.entries()].find(
      ([, code]) => (code ?? "").toUpperCase() === FABRIC_CLASS_CODE,
    )?.[0] ?? null;

  return {
    fabricClassId,
    fabricTypes: (typeRes.data ?? []) as unknown as ConfigLookup[],
    yarns: ((yarnRes.data ?? []) as {
      id: string;
      code: string | null;
      name: string;
      is_active: boolean;
      item_class_id: string | null;
    }[])
      .filter((r) => !!yarnClassId && r.item_class_id === yarnClassId)
      .map((r) => ({ id: r.id, code: r.code, name: r.name, inactive: isInactive(r) })),
  };
}

async function getYarnStageRows(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, kind, code, name, notes, is_active")
    .eq("kind", "yarn_stage")
    .order("name");
  return (data ?? []) as unknown as ConfigLookup[];
}

export type FabricBomFormData = {
  orders: FabricBomOrderOption[];
  fabrics: FabricOption[];
  structures: PickerRow[];
  components: PickerRow[];
  /** Coordinates — `items` of class GAR. Labels the Components sheet's
   *  read-only Coordinate cell; never picked directly (0495). */
  coordinates: PickerRow[];
  uoms: UomRow[];
  /** Fabric Process (0492) — the master, unfiltered; see `getFabricProcessRows`. */
  processes: FabricProcessOption[];
  processLookups: FabricProcessLookups;
  /** Yarn Process (0493) — the same master as `processes`, carrying `for_yarn`.
   *  There is no yarn ITEM list beside it: the tab's rows are derived from the
   *  fabrics' compositions, so nothing on it picks a yarn. */
  yarnProcesses: YarnProcessOption[];
  /** The Stage ▾ — GREY / DYED (0504). Its own kind, not 0492's `fabric_stage`;
   *  see that migration on why one shared list would offer WASH on a yarn. */
  yarnStages: ConfigLookup[];
  /** What the Fabric cell's "+ Add" needs — see `FabricCreateFeed`. */
  fabricCreate: FabricCreateFeed;
};

export async function getFabricBomFormData(): Promise<FabricBomFormData> {
  const [
    orders,
    fabrics,
    structures,
    components,
    coordinates,
    uoms,
    processes,
    processLookups,
    yarnProcesses,
    yarnStages,
    fabricCreate,
  ] = await Promise.all([
    getOrderOptions(),
    getFabricRows(),
    getStructureRows(),
    getComponentRows(),
    getCoordinateRows(),
    getUomRows(),
    getFabricProcessRows(),
    getFabricProcessLookupRows(),
    getYarnProcessRows(),
    getYarnStageRows(),
    getFabricCreateFeed(),
  ]);
  return {
    orders,
    fabrics,
    structures,
    components,
    coordinates,
    uoms,
    processes,
    processLookups,
    yarnProcesses,
    yarnStages,
    fabricCreate,
  };
}

// ---------------------------------------------------------------------------
// Yarn Process — the compositions the tab's rows are derived FROM (0493)
// ---------------------------------------------------------------------------

/** What the Yarn Process tab needs to build its rows: each fabric's yarn list,
 *  and a name for every yarn in them. Arrays, not Maps — this crosses a server
 *  action boundary and a Map does not survive serialisation. */
export type BomYarnComposition = {
  compositions: FabricComposition[];
  yarns: { id: string; name: string; inactive: boolean }[];
};

/**
 * THE "BRACKET RULE", READ FROM THE SIDE THAT CANNOT BE MIS-PARSED (0493).
 *
 * The client describes extracting a fabric's yarns from the parentheses in its
 * name. In this database that bracket is a RENDERING of `material_mixings`, not
 * a source: 13 of the 14 live fabrics carry brackets and every one matches its
 * mixing rows exactly, because the master COMPOSES the name from that grid
 * (`nameIsComposed` in material-master-screen.tsx). So this reads the grid.
 * Parsing the string would re-derive what generated it, and would split on the
 * first comma inside a yarn's own name.
 *
 * The rule it depends on is already stated in `lib/orders/amendments/service.ts`:
 * "a Fabric MUST declare `material_mixings` … each mixing line names a yarn".
 *
 * A FLAT SELECT, NEVER AN EMBED. `material_mixings` holds TWO FKs to `items`
 * (`item_id` and `component_item_id`), so an unqualified embed is ambiguous and
 * fails the WHOLE query — the trap `order-seed.ts` spells out and `getFabricRows`
 * names its constraints to avoid.
 *
 * IT ANSWERS FOR THE FABRICS IT IS GIVEN and does not look up the BOM. The
 * planner may be mid-edit with lines not yet saved — a BOM being created has no
 * row to read at all — so the caller passes the fabric ids the FORM holds. Same
 * call `loadOrderProduction` makes for the order.
 *
 * `blend_pct` RIDES ALONG AND IS OFTEN NULL. That is not missing data: the
 * material master hides the % column for Single Yarn and yarn-dyed fabrics, so
 * a null is the ordinary state for exactly the fabrics this tab serves. What to
 * do about it is `yarnShareOf`'s job, and it refuses rather than guessing.
 *
 * DEACTIVATED YARNS ARE RETURNED, tagged. The composition is a fact about the
 * fabric whether or not the yarn is still bought; hiding one would silently drop
 * a purchase line for a yarn the cloth is made of.
 */
export async function getBomYarnComposition(
  fabricItemIds: string[],
): Promise<BomYarnComposition> {
  const ids = [...new Set(fabricItemIds.filter(Boolean))];
  if (ids.length === 0) return { compositions: [], yarns: [] };

  const s = await createClient();
  const { data: mixRows } = await s
    .from("material_mixings")
    .select("item_id, component_item_id, blend_pct, sno")
    .in("item_id", ids)
    .order("sno");

  const mixes = ((mixRows ?? []) as {
    item_id: string | null;
    component_item_id: string | null;
    blend_pct: number | null;
  }[]).filter((m) => m.item_id && m.component_item_id);

  const yarnIds = [...new Set(mixes.map((m) => m.component_item_id as string))];

  const { data: itemRows } = await s
    .from("items")
    .select("id, name, is_active")
    .in("id", [...new Set([...yarnIds, ...ids])]);

  const byId = new Map(
    ((itemRows ?? []) as { id: string; name: string; is_active: boolean }[]).map((r) => [r.id, r]),
  );

  const byFabric = new Map<string, FabricComposition>();
  for (const m of mixes) {
    const fabricId = m.item_id as string;
    const comp = byFabric.get(fabricId) ?? {
      fabric_id: fabricId,
      /* THE FABRIC'S NAME, because every refusal `yarnShareOf` produces names it
         — "YARN DYED SINGLE JERSEY names 2 yarns with no blend percentages".
         A refusal that cannot say WHICH fabric sends the planner to read all of
         them. */
      fabric_name: byId.get(fabricId)?.name ?? "",
      components: [],
    };
    comp.components.push({
      yarn_id: m.component_item_id as string,
      blend_pct: m.blend_pct == null ? null : Number(m.blend_pct),
    });
    byFabric.set(fabricId, comp);
  }

  return {
    compositions: [...byFabric.values()],
    yarns: yarnIds.map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: row?.name ?? "",
        inactive: row ? isInactive(row) : false,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Color/Print Details — the three panels the ORDER already declares
// ---------------------------------------------------------------------------

/**
 * The garment order's own palette: yarn dyeing, fabric dyeing, roll form prints.
 *
 * ## THESE ARE READ, NEVER COPIED, AND THAT IS THE POINT OF 0490
 *
 * The legacy Fabric BOM's Color/Print Details tab (client screenshot 2577) has
 * four panels and lets the operator type all four. Three of them are lists this
 * order ALREADY holds — `garment_order_amendment_dyeings` (section 'yarn' /
 * 'fabric') and `_prints`, maintained on Garment Order ▸ Color/Print Details —
 * and a fabric BOM names exactly one order (`garment_order_id` is NOT NULL and
 * is the header's only mandatory field), so there is never a question of WHICH
 * order's palette applies.
 *
 * Storing them again would be a second copy free to drift from the first, and
 * would ask the operator to retype what they have already told the order. The
 * fourth panel — Dia / Size / Width — is the one the order cannot answer, and
 * it is the only one 0490 gives a table.
 *
 * ## IT RETURNS EMPTY LISTS, NEVER A FALLBACK
 *
 * An order that has declared no dyeing rows gets three empty panels and a line
 * saying where they are maintained. Falling back to the colour master would
 * make the panel look answered and teach the operator that the order's own tab
 * need not be filled in — the "empty and explain, never a silent fallback" half
 * of the nominated-vendor rule (AGENTS.md).
 */
export async function getOrderPalette(
  garmentOrderId: string,
): Promise<OrderPalette> {
  const s = await createClient();

  const [dyeRes, printRes] = await Promise.all([
    s
      .from("garment_order_amendment_dyeings")
      .select("sno, section, dye_type, color_name")
      .eq("amendment_id", garmentOrderId)
      .order("sno"),
    s
      .from("garment_order_amendment_prints")
      .select("sno, print_name")
      .eq("amendment_id", garmentOrderId)
      .order("sno"),
  ]);

  type DyeRow = {
    sno: number;
    section: string | null;
    dye_type: string | null;
    color_name: string | null;
  };

  /* A ROW THAT NAMES NOTHING IS NOT SHOWN. The order's grids open on a blank
     row like every grid in this app, and `writeChildren` stores whatever the
     form sent — so a palette panel that rendered them would print empty lines
     under a heading and read as a list that had been filled in badly. */
  const said = (r: { dye_type: string | null; color_name: string | null }) =>
    !!(r.dye_type ?? "").trim() || !!(r.color_name ?? "").trim();

  const dyeings = ((dyeRes.data ?? []) as unknown as DyeRow[]).filter(said);

  return {
    yarn: dyeings.filter((d) => d.section === "yarn"),
    fabric: dyeings.filter((d) => d.section === "fabric"),
    prints: ((printRes.data ?? []) as unknown as { sno: number; print_name: string | null }[])
      .filter((p) => !!(p.print_name ?? "").trim()),
  };
}

// ---------------------------------------------------------------------------
// Components ▸ the order's panel-to-fabric declaration (0495)
// ---------------------------------------------------------------------------

/**
 * WHICH PANEL OF WHICH STYLE IS CUT FROM WHICH FABRIC CATEGORY — the order's own
 * answer, and the whole of the client's "strict structure-to-component
 * association" rule.
 *
 * `garment_order_amendment_style_components` (0457) already states it, per
 * style, and `fabric_category_id` is a `categories` row — the SAME thing
 * `order_fabric_bom_lines.structure_id` holds (0409 moved both). So the rule is
 * a join, not a lookup table anybody maintains.
 *
 * ## READ, NEVER COPIED — the fourth time this module makes that call
 *
 * 0490 read the palette rather than storing it, 0491 read levels 1-2 of the
 * Manual tree, 0492 read the Fabric Detail header. Same argument each time and
 * it is the strongest one here: a copy of "Neck is rib" on the BOM would be free
 * to disagree with the order that declared it, and the disagreement would decide
 * what gets bought.
 *
 * ## NO NAMES ARE RESOLVED, DELIBERATELY
 *
 * Unlike `getOrderFabricSeed` beside it, this returns raw ids. Its consumer is a
 * FILTER over the screen's existing Component and Coordinate picker lists —
 * which already carry names, already carry `inactive`, and are already the lists
 * every other cell on the line resolves against. Resolving a second set here
 * would give one component two labels on one screen, and the pickers' is the one
 * the operator is choosing from.
 *
 * Ordered by `sno` so the offered list follows the order's own sequence: FRONT
 * BODY before BACK BODY before SLEEVE, as the operator entered them.
 */
export async function getOrderStyleComponents(
  garmentOrderId: string,
): Promise<StyleComponentDecl[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_order_amendment_style_components")
    .select("style_ref_no, coordinate_id, component_id, fabric_category_id")
    .eq("amendment_id", garmentOrderId)
    .order("sno");

  return (data ?? []) as unknown as StyleComponentDecl[];
}
