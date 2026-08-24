import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import type { CadMarker, CadStatus } from "./types";
import {
  orderPanelRows,
  panelNameIds,
  type ComboSource,
  type OrderPanelRow,
  type StyleComponentSource,
} from "./panels";
import type { CadWeightRow } from "./weights";

/**
 * Orders ▸ CAD Markers — the reads.
 *
 * ## THE SELECT STRINGS ARE DELIBERATELY SHORT
 *
 * `lib/orders/amendments/service.ts` records the failure at length: PostgREST
 * resolves every relationship before returning a row, and ONE unresolvable name
 * fails ALL of them — so the screen shows an empty list with no error and reads
 * exactly like "there is nothing here yet". Every embed named below is one the
 * screen actually renders.
 *
 * ## `withCreators`, NOT AN EMBED
 *
 * `profiles_read_own` lets a user select only their OWN profile row, so
 * `creator:profiles!created_by(full_name)` resolves to null for every record
 * made by anybody else — and it looks right for exactly as long as the column is
 * NULL everywhere. `creator_names()` is SECURITY DEFINER and returns id + name.
 */

// ---------------------------------------------------------------------------
// The work queue
// ---------------------------------------------------------------------------

/**
 * A master row as a picker option.
 *
 * DECLARED HERE, not imported from `components/ui/data-picker`: that `PickerRow`
 * is the PANEL's own shape (`label` / `sublabel` / `short`), which is a
 * rendering concern, and a `server-only` service naming it would tie the read to
 * the component that happens to draw it today. `lib/orders/fabric-bom/service.ts`
 * declares the same four fields for the same reason.
 */
export type CadPickerRow = { id: string; code: string | null; name: string; inactive: boolean };

/** One confirmed garment order, with the state of its CAD sheet. */
export type CadTaskRow = {
  /** The ORDER's id — the queue lists orders, so an order with no sheet is a
   *  row rather than an absence. That is the whole reason "Pending" can be
   *  shown for the case it describes. */
  id: string;
  order_code: string | null;
  /** The RE No (ஆரி நம்பர்) — `sales_orders.order_number`, 0395. */
  re_no: string | null;
  po_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  created_at: string | null;
  created_by: string | null;

  marker_id: string | null;
  status: CadStatus | null;
  /** How many markers the sheet holds, and how many panels are weighed. */
  layout_count: number;
  weighed_count: number;
  /** Panels on the sheet still carrying no weight — the number CAD is short by. */
  unweighed_count: number;
};

const ORDER_SELECT =
  "id, code, po_no, delivery_date, created_at, created_by, " +
  "customer:customers(id,code,name), " +
  "sales_order:sales_orders(id,order_number)";

type OrderLite = {
  id: string;
  code: string | null;
  po_no: string | null;
  delivery_date: string | null;
  created_at: string | null;
  created_by: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  sales_order: { id: string; order_number: string | null } | null;
};

export async function listCadTasks(): Promise<CadTaskRow[]> {
  const s = await createClient();

  const [ordersRes, markersRes] = await Promise.all([
    s
      .from("garment_order_amendments")
      .select(ORDER_SELECT)
      // Drafts are excluded for the reason `confirmedOrdersForBom` gives: a
      // draft order's styles and components are still being typed, so a marker
      // measured against them would be measured against a moving target.
      .eq("is_draft", false)
      .order("created_at", { ascending: false }),
    s
      .from("order_cad_markers")
      .select(
        "id, garment_order_id, status, " +
          "layouts:order_cad_marker_layouts(id, weights:order_cad_component_weights(grams))",
      ),
  ]);

  type MarkerLite = {
    id: string;
    garment_order_id: string;
    status: CadStatus;
    layouts: { id: string; weights: { grams: number | null }[] | null }[] | null;
  };

  // ONE SHEET PER ORDER IS A CONSTRAINT (`uq_order_cad_marker_order`, 0460), so
  // a Map keyed on the order is exactly as strong as the index and there is no
  // "latest wins" pass to get wrong — the same call `listFabricBomTasks` makes.
  const byOrder = new Map<string, MarkerLite>();
  for (const m of (markersRes.data ?? []) as unknown as MarkerLite[]) {
    byOrder.set(m.garment_order_id, m);
  }

  const rows: CadTaskRow[] = ((ordersRes.data ?? []) as unknown as OrderLite[]).map((o) => {
    const m = byOrder.get(o.id) ?? null;
    const weights = (m?.layouts ?? []).flatMap((l) => l.weights ?? []);
    return {
      id: o.id,
      order_code: o.code,
      re_no: o.sales_order?.order_number ?? null,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      delivery_date: o.delivery_date,
      created_at: o.created_at,
      created_by: o.created_by,
      marker_id: m?.id ?? null,
      status: m?.status ?? null,
      layout_count: m?.layouts?.length ?? 0,
      // COUNTED, NOT INFERRED FROM THE TOTAL. "3 panels, 3 weighed" and
      // "3 panels, 2 weighed" are different states and only the second is
      // something CAD has to act on; a single count cannot tell them apart.
      weighed_count: weights.filter((w) => w.grams != null).length,
      unweighed_count: weights.filter((w) => w.grams == null).length,
    };
  });

  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

export async function listCadMarkers(): Promise<CadMarker[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("order_cad_markers")
    .select(
      "*, garment_order:garment_order_amendments(id, code, po_no, delivery_date, " +
        "customer:customers(id,code,name), sales_order:sales_orders(id,order_number)), " +
        "layouts:order_cad_marker_layouts(*, weights:order_cad_component_weights(*))",
    )
    .order("created_at", { ascending: false });

  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. `data ?? []` over a 400 is
  // what turned a broken embed into "there are no orders yet" on the amendment
  // list (2026-08-11), with nothing on screen saying the schema was behind.
  if (error) throw new Error(`Could not load CAD markers: ${error.message}`);

  return withCreators(
    ((data ?? []) as unknown as CadMarker[]).map((m) => ({
      ...m,
      layouts: [...(m.layouts ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((l) => ({ ...l, weights: [...(l.weights ?? [])].sort((a, b) => a.sno - b.sno) })),
    })),
  );
}

// ---------------------------------------------------------------------------
// The order's own panels — what a marker may weigh
// ---------------------------------------------------------------------------

/**
 * The panels an order declares, with the names their masters give them.
 *
 * THE FLATTENING ITSELF IS `./panels.ts`, and it is there rather than here
 * because it decides which fabric each panel is cut from — the field that stops
 * a contrast yoke being weighed once and charged to two Fabric BOM lines. This
 * file is `server-only`, so a rule that expensive would sit where no vector can
 * reach it. What is left here is the two queries and the name lookups.
 *
 * Both sources state the fabric as a `categories` id — `pg_constraint`, not a
 * code comment: `garment_order_amendment_combo_structures.structure_id` was
 * created against `config_lookups` by 0408 and REPOINTED at `categories` by
 * 0409 minutes later, so 0408's own header is stale on exactly this point.
 */
export type { OrderPanelRow };

export async function getOrderPanels(garmentOrderId: string): Promise<OrderPanelRow[]> {
  const s = await createClient();

  const [ownRes, comboRes] = await Promise.all([
    s
      .from("garment_order_amendment_style_components")
      .select("style_ref_no, coordinate_id, component_id, fabric_category_id")
      .eq("amendment_id", garmentOrderId)
      .order("sno"),
    s
      .from("garment_order_amendment_combos")
      .select(
        "style_ref_no, " +
          "structures:garment_order_amendment_combo_structures(structure_id, " +
          "components:garment_order_amendment_combo_components(coordinate_id, component_id))",
      )
      .eq("amendment_id", garmentOrderId)
      .order("sno"),
  ]);

  const own = (ownRes.data ?? []) as unknown as StyleComponentSource[];
  const combos = (comboRes.data ?? []) as unknown as ComboSource[];

  const ids = panelNameIds(own, combos);
  const [coordinates, components, categories] = await Promise.all([
    nameMap(s, "items", "name", ids.coordinates),
    nameMap(s, "components", "short_name", ids.components),
    // `short_name`, because `categories.name` is NULLABLE (0228) — a category
    // saved with only a short name would otherwise label a panel with nothing.
    nameMap(s, "categories", "short_name", ids.categories),
  ]);

  return orderPanelRows(own, combos, { coordinates, components, categories });
}

async function nameMap(
  s: Awaited<ReturnType<typeof createClient>>,
  table: string,
  nameCol: string,
  ids: Set<string>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  const { data } = await s.from(table).select(`id, ${nameCol}`).in("id", [...ids]);
  return new Map(
    ((data ?? []) as unknown as Record<string, string>[]).map((r) => [r.id, r[nameCol]]),
  );
}

// ---------------------------------------------------------------------------
// The sheet's weights, flattened for the engine
// ---------------------------------------------------------------------------

/**
 * Every weight row on one order's CAD sheet, in the shape
 * `componentWeightsForOrder` reads.
 *
 * ONE FLATTENING, TWO CALLERS — the seed action and the screen's own preview
 * both come through here, so the number CAD sees and the number written to the
 * Fabric BOM cannot be derived two ways. Returns `null` when the order has no
 * sheet at all, which is a different statement from "a sheet with no weights"
 * and gets a different sentence from the caller.
 *
 * THE STATUS TRAVELS WITH THE ROWS. §2's handoff happens on SUBMIT, so the seed
 * has to know whether the sheet is still a draft — and a second query for one
 * column is a second chance for the two to disagree about which sheet they read.
 */
export type CadSheetWeights = { status: CadStatus; rows: CadWeightRow[] };

export async function getCadWeightRows(garmentOrderId: string): Promise<CadSheetWeights | null> {
  const s = await createClient();

  const { data } = await s
    .from("order_cad_markers")
    .select(
      "id, status, layouts:order_cad_marker_layouts(sno, style_ref_no, dia, file_name, " +
        "weights:order_cad_component_weights(coordinate_id, component_id, fabric_category_id, grams))",
    )
    .eq("garment_order_id", garmentOrderId)
    .maybeSingle();

  if (!data) return null;

  type Row = {
    status: CadStatus;
    layouts:
      | {
          sno: number;
          style_ref_no: string | null;
          dia: number | null;
          file_name: string | null;
          weights:
            | {
                coordinate_id: string | null;
                component_id: string | null;
                fabric_category_id: string | null;
                grams: number | null;
              }[]
            | null;
        }[]
      | null;
  };

  const sheet = data as unknown as Row;

  const coordinateIds = new Set<string>();
  const componentIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const l of sheet.layouts ?? []) {
    for (const w of l.weights ?? []) {
      if (w.coordinate_id) coordinateIds.add(w.coordinate_id);
      if (w.component_id) componentIds.add(w.component_id);
      if (w.fabric_category_id) categoryIds.add(w.fabric_category_id);
    }
  }
  const [coordNames, compNames, catNames] = await Promise.all([
    nameMap(s, "items", "name", coordinateIds),
    nameMap(s, "components", "short_name", componentIds),
    nameMap(s, "categories", "short_name", categoryIds),
  ]);

  const out: CadWeightRow[] = [];
  for (const l of sheet.layouts ?? []) {
    // THE LABEL IS WHAT THE DUPLICATE REFUSAL PRINTS. "Marker 2" is the row
    // number the operator can count down to; a uuid is legible to nobody.
    const label =
      [l.style_ref_no, l.dia != null ? `${l.dia}"` : null].filter(Boolean).join(" ") ||
      `Marker ${l.sno}`;
    for (const w of l.weights ?? []) {
      out.push({
        style_ref_no: l.style_ref_no,
        coordinate_id: w.coordinate_id,
        coordinate_name: w.coordinate_id ? (coordNames.get(w.coordinate_id) ?? null) : null,
        component_id: w.component_id,
        component_name: w.component_id ? (compNames.get(w.component_id) ?? null) : null,
        fabric_category_id: w.fabric_category_id,
        fabric_category_name: w.fabric_category_id
          ? (catNames.get(w.fabric_category_id) ?? null)
          : null,
        grams: w.grams,
        dia: l.dia,
        layout_label: label,
      });
    }
  }
  return { status: sheet.status, rows: out };
}

// ---------------------------------------------------------------------------
// What the editor asks for once, at mount
// ---------------------------------------------------------------------------

export type CadOrderOption = {
  id: string;
  code: string | null;
  name: string;
  re_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
};

async function getOrderOptions(): Promise<CadOrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_order_amendments")
    .select(ORDER_SELECT)
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as OrderLite[]).map((o) => ({
    id: o.id,
    // THE CODE IS THE IDENTITY HERE, NOT THE NAME. Five orders all reading
    // "Aurelia Retail" is the exact complaint `RecordPicker` records for SC No
    // (client 2026-08-10) — so the RE No leads and the customer is the label.
    code: o.sales_order?.order_number ?? o.code,
    name: o.customer?.name ?? o.code ?? "(no customer)",
    re_no: o.sales_order?.order_number ?? null,
    customer_name: o.customer?.name ?? null,
    delivery_date: o.delivery_date,
  }));
}

/**
 * The garment panels a weight may name.
 *
 * `inactive`, NOT `is_active`. `components` was renamed to `inactive` by 0299,
 * and PostgREST answers a select over a MISSING column with an ERROR rather than
 * nulls — so the query returns nothing and the dropdown is silently EMPTY on
 * every row. That exact mistake left the Style screen's Component picker blank
 * for weeks. `short_name` IS the name: the table has no `name` and no `code`.
 */
async function getComponentRows(): Promise<CadPickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("components").select("id, short_name, inactive").order("short_name");
  return ((data ?? []) as { id: string; short_name: string; inactive: boolean }[]).map((r) => ({
    id: r.id,
    code: null,
    name: r.short_name,
    inactive: isInactive(r),
  }));
}

export type CadFormData = {
  orders: CadOrderOption[];
  /** The whole master — the per-order narrowing is `getOrderPanels`, and the
   *  value a saved row ALREADY HOLDS has to stay resolvable (AGENTS.md,
   *  Disabled rows), which a pre-narrowed list cannot promise. */
  components: CadPickerRow[];
};

export async function getCadFormData(): Promise<CadFormData> {
  const [orders, components] = await Promise.all([getOrderOptions(), getComponentRows()]);
  return { orders, components };
}
