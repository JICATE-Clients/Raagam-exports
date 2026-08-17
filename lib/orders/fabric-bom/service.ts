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
import type { FabricBom, OrderFabricSeedRow } from "./types";

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
        "requirements:order_fabric_bom_requirements(*)",
    )
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as FabricBom[]).map((r) => ({
      ...r,
      lines: [...(r.lines ?? [])].sort((a, b) => a.sno - b.sno),
      requirements: [...(r.requirements ?? [])].sort((a, b) => a.sno - b.sno),
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
 * back for DISPLAY, so two otherwise identical rows can be told apart while
 * seeding, and are then dropped: a copy on the BOM line is a second place for
 * them to disagree with the order, and the order is the one that is right.
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
      "style_ref_no, combo, " +
        "structures:garment_order_amendment_combo_structures(" +
        "structure_id, fabric_type, item_sub_type, gsm, " +
        "components:garment_order_amendment_combo_components(component_id, color_name))",
    )
    .eq("amendment_id", garmentOrderId)
    .order("sno");

  type ComboRow = {
    style_ref_no: string | null;
    combo: string | null;
    structures:
      | {
          structure_id: string | null;
          fabric_type: string | null;
          item_sub_type: string | null;
          gsm: number | null;
          components: { component_id: string | null; color_name: string | null }[] | null;
        }[]
      | null;
  };

  const rows = (data ?? []) as unknown as ComboRow[];

  const structureIds = new Set<string>();
  const componentIds = new Set<string>();
  for (const c of rows) {
    for (const st of c.structures ?? []) {
      if (st.structure_id) structureIds.add(st.structure_id);
      for (const cp of st.components ?? []) {
        if (cp.component_id) componentIds.add(cp.component_id);
      }
    }
  }

  const [structureNames, componentNames] = await Promise.all([
    nameMap("categories", [...structureIds]),
    nameMap("components", [...componentIds]),
  ]);

  const out: OrderFabricSeedRow[] = [];
  for (const c of rows) {
    for (const st of c.structures ?? []) {
      const parts = st.components ?? [];
      // A STRUCTURE WITH NO COMPONENTS STILL SEEDS ONE ROW. The nested grid is
      // optional on the order — a body fabric named with no panel breakdown is
      // an ordinary state — and dropping it here would silently leave the
      // largest fabric on the order out of its own BOM.
      const leaves = parts.length > 0 ? parts : [{ component_id: null, color_name: null }];
      for (const cp of leaves) {
        out.push({
          style_ref_no: c.style_ref_no,
          combo: c.combo,
          structure_id: st.structure_id,
          structure_name: st.structure_id ? (structureNames.get(st.structure_id) ?? null) : null,
          component_id: cp.component_id,
          component_name: cp.component_id ? (componentNames.get(cp.component_id) ?? null) : null,
          fabric_type: st.fabric_type,
          // The COMPONENT's fabric colour where it has one, falling back to the
          // colourway's own name. A component colour is a contrast panel; with
          // none, the panel is the garment's colour, which is what `combo` says.
          color_name: cp.color_name ?? c.combo,
          item_sub_type: st.item_sub_type,
          gsm: st.gsm,
        });
      }
    }
  }
  return out;
}

/** id -> name for a master, in one round trip. Deactivated rows INCLUDED: this
 *  labels what the order already holds, and a blank label on a real row is the
 *  "Disabled rows" failure read from the display side. */
async function nameMap(table: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const s = await createClient();
  const { data } = await s.from(table).select("id, name").in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };
export type UomRow = PickerRow & { decimal_places_allowed: number | null };

/** The garment orders a BOM may be raised against — the same confirmed set the
 *  queue lists, shaped for a picker. */
export type FabricBomOrderOption = PickerRow & {
  customer_name: string | null;
  delivery_date: string | null;
  /** The style refs the order declares, for the line's Style cell. */
  styles: string[];
  /** The colourways it declares, for the line's Combo cell. */
  combos: string[];
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
    combos: [...new Set((o.combos ?? []).map((c) => c.combo).filter(Boolean))] as string[],
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
    .filter((r) => isFabricClassId(classes, r.item_class_id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      class_code: FABRIC_CLASS_CODE,
      inactive: isInactive(r),
    }));
}

/** Fabric structures — `categories` of the FABRIC item class, which is where
 *  0409 moved the ORDER's own structure column, so the two lists agree. */
async function getStructureRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const [catRes, classes] = await Promise.all([
    s.from("categories").select("id, code, name, inactive, item_class_id").order("name"),
    itemClassCodes(),
  ]);

  return ((catRes.data ?? []) as {
    id: string;
    code: string | null;
    name: string;
    inactive: boolean;
    item_class_id: string | null;
  }[])
    .filter((r) => isFabricClassId(classes, r.item_class_id))
    .map((r) => ({ id: r.id, code: r.code, name: r.name, inactive: isInactive(r) }));
}

async function getComponentRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("components").select("id, code, name, is_active").order("name");
  return ((data ?? []) as (Omit<PickerRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
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

export type FabricBomFormData = {
  orders: FabricBomOrderOption[];
  fabrics: FabricOption[];
  structures: PickerRow[];
  components: PickerRow[];
  uoms: UomRow[];
};

export async function getFabricBomFormData(): Promise<FabricBomFormData> {
  const [orders, fabrics, structures, components, uoms] = await Promise.all([
    getOrderOptions(),
    getFabricRows(),
    getStructureRows(),
    getComponentRows(),
    getUomRows(),
  ]);
  return { orders, fabrics, structures, components, uoms };
}
