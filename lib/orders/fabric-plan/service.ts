import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import { confirmedOrdersForBom } from "@/lib/orders/bom-order-basis";
import {
  fabricPlanStatusOf,
  FABRIC_PLAN_STATUS_RANK,
  type FabricPlan,
  type FabricPlanTaskRow,
  type PlannableFabric,
} from "./types";

export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };
export type UomRow = PickerRow & { decimal_places_allowed: number | null };

// ---------------------------------------------------------------------------
// The work queue
// ---------------------------------------------------------------------------

/**
 * One row per confirmed garment ORDER, with the state of its fabric route.
 *
 * IT DOES NOT REUSE `bomTaskRows`, and the reason is worth reading before
 * someone folds them together. That function answers "has the ORDER moved since
 * the BOM was computed?" — a fingerprint comparison over approval quantities.
 * This asks "has the BOM moved since the ROUTE was planned?", which is a
 * different pair of timestamps over different documents. Sharing the code would
 * mean sharing the word "Recalculate" between two questions that can disagree:
 * an order can sit still while its BOM is re-costed, and a BOM can be recomputed
 * without any fabric changing.
 *
 * What IS shared is `confirmedOrdersForBom()` — the confirmed-orders rule and
 * the select string behind it, which is where a divergence would actually hurt.
 */
export async function listFabricPlanTasks(): Promise<FabricPlanTaskRow[]> {
  const s = await createClient();

  const [orders, bomsRes, plansRes] = await Promise.all([
    confirmedOrdersForBom(),
    s
      .from("order_fabric_boms")
      .select("id, garment_order_id, is_draft, computed_at, lines:order_fabric_bom_lines(id)"),
    s
      .from("order_fabric_plans")
      .select(
        "id, garment_order_id, is_draft, bom_computed_at, " +
          "stages:order_fabric_plan_stages(id)",
      ),
  ]);

  type BomRow = {
    id: string;
    garment_order_id: string;
    is_draft: boolean;
    computed_at: string | null;
    lines: { id: string }[] | null;
  };
  type PlanRow = {
    id: string;
    garment_order_id: string;
    is_draft: boolean;
    bom_computed_at: string | null;
    stages: { id: string }[] | null;
  };

  const boms = new Map(
    ((bomsRes.data ?? []) as unknown as BomRow[]).map((b) => [b.garment_order_id, b]),
  );
  const plans = new Map(
    ((plansRes.data ?? []) as unknown as PlanRow[]).map((p) => [p.garment_order_id, p]),
  );

  const rows: FabricPlanTaskRow[] = orders.map((o) => {
    const bom = boms.get(o.id) ?? null;
    const plan = plans.get(o.id) ?? null;
    const fabricCount = bom?.lines?.length ?? 0;

    return {
      id: o.id,
      sc_no: o.sales_order?.order_number ?? null,
      order_code: o.code,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      delivery_date: o.delivery_date,
      fabric_count: fabricCount,
      status: fabricPlanStatusOf({
        // A DRAFT BOM IS NOT A BOM TO PLAN AGAINST. It is someone's
        // half-finished thinking, and a route built on it would be re-planned
        // the moment it was recorded — the same call `listBomCopySources` makes
        // about copying from a draft.
        bomRecorded: !!bom && !bom.is_draft && fabricCount > 0,
        bomComputedAt: bom?.computed_at ?? null,
        planExists: !!plan,
        planIsDraft: plan?.is_draft ?? false,
        planBomComputedAt: plan?.bom_computed_at ?? null,
        stageCount: plan?.stages?.length ?? 0,
      }),
      plan_id: plan?.id ?? null,
      stage_count: plan?.stages?.length ?? 0,
      created_at: o.created_at,
      created_by: o.created_by,
    };
  });

  rows.sort(
    (a, b) =>
      FABRIC_PLAN_STATUS_RANK[a.status] - FABRIC_PLAN_STATUS_RANK[b.status] ||
      (a.delivery_date ?? "9999").localeCompare(b.delivery_date ?? "9999"),
  );

  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

export async function listFabricPlans(): Promise<FabricPlan[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_fabric_plans")
    .select(
      "*, garment_order:garment_order_amendments(id, code, po_no, delivery_date, " +
        "customer:customers(id,code,name), sales_order:sales_orders(id,order_number)), " +
        "lines:order_fabric_plan_lines(*, stages:order_fabric_plan_stages(*))",
    )
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as FabricPlan[]).map((p) => ({
      ...p,
      lines: [...(p.lines ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((l) => ({ ...l, stages: [...(l.stages ?? [])].sort((a, b) => a.sno - b.sno) })),
    })),
  );
}

// ---------------------------------------------------------------------------
// What there is to plan: the BOM, read as a list of fabrics
// ---------------------------------------------------------------------------

/**
 * One order's Fabric BOM, flattened into the fabrics a route can hang under.
 *
 * ## THE REQUIREMENT IS SUMMED ACROSS SLICES, AND THAT IS THE INTERESTING PART
 *
 * A BOM line explodes into one requirement row per colourway, or per colourway
 * and size (0426). A ROUTE does not: the same yarn is knitted for every size,
 * and dyeing is per colour, which the line's own `combo` already carries. So the
 * plan takes the line's TOTAL — the sum of its slices — and a size-wise BOM line
 * plans as one fabric rather than as five.
 *
 * ## A REFUSED SLICE POISONS THE WHOLE FABRIC
 *
 * If one colourway of three refused, summing the other two gives a smaller total
 * that looks exactly like a correct answer — and it would be bought. So a fabric
 * with any refused slice reports `required_qty: null` and carries the refusal's
 * sentence instead. That is the same call `productionSlices` makes one document
 * up, for the same reason.
 */
export async function getPlannableFabrics(
  garmentOrderId: string,
): Promise<{ bomId: string | null; bomComputedAt: string | null; fabrics: PlannableFabric[] }> {
  const s = await createClient();

  const { data: bom } = await s
    .from("order_fabric_boms")
    .select(
      "id, is_draft, computed_at, " +
        "lines:order_fabric_bom_lines(id, sno, style_ref_no, combo, structure_id, component_id, item_id, consumption_uom_id), " +
        "requirements:order_fabric_bom_requirements(line_id, required_qty, refusal_reason, consumption_uom_id)",
    )
    .eq("garment_order_id", garmentOrderId)
    .maybeSingle();

  if (!bom) return { bomId: null, bomComputedAt: null, fabrics: [] };

  type Line = {
    id: string;
    sno: number;
    style_ref_no: string | null;
    combo: string | null;
    structure_id: string | null;
    component_id: string | null;
    item_id: string | null;
    consumption_uom_id: string | null;
  };
  type Req = {
    line_id: string;
    required_qty: number | null;
    refusal_reason: string | null;
    consumption_uom_id: string | null;
  };

  const row = bom as unknown as {
    id: string;
    is_draft: boolean;
    computed_at: string | null;
    lines: Line[] | null;
    requirements: Req[] | null;
  };

  const byLine = new Map<string, Req[]>();
  for (const r of row.requirements ?? []) {
    byLine.set(r.line_id, [...(byLine.get(r.line_id) ?? []), r]);
  }

  const ids = {
    structures: new Set<string>(),
    components: new Set<string>(),
    items: new Set<string>(),
    uoms: new Set<string>(),
  };
  for (const l of row.lines ?? []) {
    if (l.structure_id) ids.structures.add(l.structure_id);
    if (l.component_id) ids.components.add(l.component_id);
    if (l.item_id) ids.items.add(l.item_id);
    if (l.consumption_uom_id) ids.uoms.add(l.consumption_uom_id);
  }

  const [structureNames, componentNames, itemNames, uomCodes] = await Promise.all([
    nameMap("categories", [...ids.structures]),
    nameMap("components", [...ids.components], "short_name"),
    nameMap("items", [...ids.items]),
    codeMap("uoms", [...ids.uoms]),
  ]);

  const fabrics: PlannableFabric[] = (row.lines ?? [])
    .slice()
    .sort((a, b) => a.sno - b.sno)
    .map((l) => {
      const reqs = byLine.get(l.id) ?? [];
      const refused = reqs.find((r) => r.refusal_reason);
      const total = reqs.reduce((a, r) => a + (Number(r.required_qty) || 0), 0);

      return {
        style_ref_no: l.style_ref_no,
        combo: l.combo,
        structure_id: l.structure_id,
        structure_name: l.structure_id ? (structureNames.get(l.structure_id) ?? null) : null,
        component_id: l.component_id,
        component_name: l.component_id ? (componentNames.get(l.component_id) ?? null) : null,
        item_id: l.item_id,
        item_name: l.item_id ? (itemNames.get(l.item_id) ?? null) : null,
        required_qty: refused || reqs.length === 0 ? null : total,
        required_uom_id: l.consumption_uom_id,
        required_uom_code: l.consumption_uom_id
          ? (uomCodes.get(l.consumption_uom_id) ?? null)
          : null,
        refusal: refused
          ? refused.refusal_reason
          : reqs.length === 0
            ? "This fabric has no computed requirement — open the Fabric BOM and save it"
            : null,
      };
    });

  return {
    bomId: row.id,
    // A DRAFT BOM REPORTS NO TIMESTAMP, so a route planned against one is
    // `replan` from the moment it is saved. That is honest: the figures it used
    // are someone's half-finished thinking, and the plan should be revisited
    // when they are recorded.
    bomComputedAt: row.is_draft ? null : row.computed_at,
    fabrics,
  };
}

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

async function codeMap(table: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const s = await createClient();
  const { data } = await s.from(table).select("id, code").in("id", ids);
  return new Map(
    ((data ?? []) as { id: string; code: string | null }[])
      .filter((r) => r.code)
      .map((r) => [r.id, r.code as string]),
  );
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

/**
 * The processes a fabric route may name.
 *
 * NARROWED TO `for_yarn` OR `for_fabric` (0227's own flags). A route runs from
 * yarn to finished fabric, so a garment or trims process is offering a stage that
 * cannot be right — the cascading-filter rule, answered by a column the master
 * already carries rather than by a new list.
 *
 * `inactive` is CARRIED, never filtered: a process a saved route already names
 * must still resolve, or the stage renders empty and the next save writes that
 * emptiness over a real FK (AGENTS.md, Disabled rows).
 */
async function getProcessRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, for_yarn, for_fabric, inactive")
    .order("sl_no");
  return ((data ?? []) as {
    id: string;
    name: string;
    for_yarn: boolean;
    for_fabric: boolean;
    inactive: boolean;
  }[])
    .filter((r) => r.for_yarn || r.for_fabric)
    .map((r) => ({ id: r.id, code: null, name: r.name, inactive: isInactive(r) }));
}

async function getVendorRows(): Promise<PickerRow[]> {
  const s = await createClient();
  // master_vendors, never public.vendors — the picker hands back a master id and
  // the wrong FK rejects every save (0376 · 0377 · 0379 · 0380 · 0427).
  // `inactive`, NOT `blocked` — 0246 CREATED this column as `blocked` and 0299
  // renamed it, so reading the create-table migration alone gives the wrong
  // answer. That is the trap `lib/masters/inactive.ts` spells out: PostgREST
  // answers a select over a MISSING column with an ERROR rather than nulls, so
  // the query returns nothing and the picker is silently empty — which on a
  // vendor field reads as "no processors are set up" rather than as a fault.
  // Verified from the catalog, which is what that file says to do.
  const { data } = await s
    .from("master_vendors")
    .select("id, code, name, inactive")
    .order("name");
  return ((data ?? []) as { id: string; code: string | null; name: string; inactive: boolean }[]).map(
    (r) => ({ id: r.id, code: r.code, name: r.name, inactive: isInactive(r) }),
  );
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

export type FabricPlanOrderOption = PickerRow & {
  customer_name: string | null;
  delivery_date: string | null;
};

async function getOrderOptions(): Promise<FabricPlanOrderOption[]> {
  const orders = await confirmedOrdersForBom();
  return orders.map((o) => ({
    id: o.id,
    code: o.sales_order?.order_number ?? o.code,
    name: [o.sales_order?.order_number ?? o.code, o.po_no, o.customer?.name]
      .filter(Boolean)
      .join(" · "),
    inactive: false,
    customer_name: o.customer?.name ?? null,
    delivery_date: o.delivery_date,
  }));
}

export type FabricPlanFormData = {
  orders: FabricPlanOrderOption[];
  processes: PickerRow[];
  vendors: PickerRow[];
  uoms: UomRow[];
};

export async function getFabricPlanFormData(): Promise<FabricPlanFormData> {
  const [orders, processes, vendors, uoms] = await Promise.all([
    getOrderOptions(),
    getProcessRows(),
    getVendorRows(),
    getUomRows(),
  ]);
  return { orders, processes, vendors, uoms };
}
