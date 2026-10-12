import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocationId } from "@/lib/auth/location";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import {
  getIwoFormData,
  type IwoFabricOption,
  type IwoStructureOption,
  type PickerRow,
} from "@/lib/orders/internal-work-orders/service";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { kilogramUom } from "@/lib/uom/kilogram";
// The ORDER Fabric BOM's own process loaders, reused unchanged (both exported,
// both order-agnostic): the route grid and the stage rules must read the SAME
// master the order screen reads, kind flags included, or an IWO route and an
// order route could compute one fabric's yarn two ways.
import {
  getFabricProcessLookupRows,
  getFabricProcessRows,
  getYarnProcessRows as loadYarnProcessRows,
} from "@/lib/orders/fabric-bom/service";
import type { FabricProcessLookups, FabricProcessOption } from "@/lib/orders/fabric-bom/processes";
import type { YarnProcessOption } from "@/lib/orders/fabric-bom/yarn-process";
import type { IwoFabricBom } from "./types";

/**
 * ONE ROW PER IWO THAT CAN HAVE A FABRIC BOM — For Yarn or Fabric — with its
 * BOM embedded when there is one. This is the IWO copy of the order screen's
 * task queue (`listFabricBomTasks`): the order screen lists confirmed ORDERS
 * and whether each has a BOM; this lists work orders and whether each has one.
 *
 * `iwo_fabric_boms` has ONE foreign key to `internal_work_orders` (unique), so
 * the embed is unambiguous and comes back as an object or null.
 *
 * SCOPED TO THE CURRENT UNIT. The BOM header is (RLS: `is_current_location`)
 * and the IWO table is not, so an unscoped list would show another unit's IWO
 * with its BOM invisible — and a "new" BOM for it would be refused on save.
 * A BOM belongs to the unit that raised its work order (0581's guard).
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md).
 */
export type IwoFabricBomTask = {
  id: string;
  code: string | null;
  iwo_date: string;
  iwo_for: IwoFor;
  /** Reference (RE No), typed on the work order (0597). */
  reference_no: string | null;
  deli_date: string | null;
  remarks: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  bom: IwoFabricBom | null;
  /** The Sample Work Order this work order was raised for (0707) — its SWO
   *  number stands where the RE No stands on a production plan, and its
   *  samples are what Fabric Consumption's SMP No offers. Null otherwise. */
  swo: IwoSwo | null;
  /** Dyeing work orders raised from this plan (0708), cancelled ones included
   *  so the list says what happened to them. */
  dyeing_orders: { id: string; code: string | null; status: string }[];
};

/** One SWO sample line as the plan offers it. */
export type IwoSwoSample = {
  style_id: string;
  /** SMP/26-27/0001 — the sample entry (enquiry) number. */
  smp_no: string | null;
  /** PRD/26-27/0001 — the style line's own number. */
  sample_no: string | null;
  style_name: string;
  /** Net kilos the SWO batched for it (its costing), for the planner to read. */
  kg: number;
  /** The fabric structures (categories) it was costed in — Fabric Allocation
   *  fills an empty Structure when there is exactly one. */
  structure_ids: string[];
};
export type IwoSwo = { id: string; code: string; samples: IwoSwoSample[] };

/** `sampleOnly` — Sample ▸ Fabric Plan lists only the work orders the
 *  Sample module raised (0704); the Orders route lists every one, samples
 *  included, since a sample plan is the same record either way. */
export async function listIwoFabricBomTasks(opts: { sampleOnly?: boolean } = {}): Promise<IwoFabricBomTask[]> {
  const locationId = await getCurrentLocationId();
  if (!locationId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("internal_work_orders")
    .select(
      "id, code, iwo_date, iwo_for, reference_no, deli_date, remarks, status, created_by, created_at, " +
        // 0708 — the dyeing orders raised from this plan. One FK (iwo_id), so the embed is unambiguous.
        "process_orders(id, code, status, process_type, created_at), " +
        "iwo_fabric_boms(*, iwo_fabric_bom_palette(*), iwo_fabric_bom_dias(*), iwo_fabric_bom_lines(*), " +
        "iwo_fabric_bom_processes(*), iwo_fabric_bom_yarns(*, iwo_fabric_bom_yarn_stages(*), iwo_fabric_bom_yarn_shades(*)), " +
        // Details ▸ Yarn Dyed Details (0599). Each yd table has one FK to its
        // parent, so the bare embeds are unambiguous.
        "iwo_fabric_bom_yd_repeats(*), iwo_fabric_bom_yd_combinations(*, iwo_fabric_bom_yd_combination_colors(*)))",
    )
    .in("iwo_for", ["yarn", "fabric"])
    .eq("location_id", locationId)
    .in("is_sample", opts.sampleOnly ? [true] : [true, false])
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  if (error) throw new Error(`IWO Fabric Plan: ${error.message}`);

  type Raw = Omit<IwoFabricBomTask, "bom" | "swo" | "dyeing_orders"> & {
    iwo_fabric_boms: IwoFabricBom | IwoFabricBom[] | null;
    process_orders: { id: string; code: string | null; status: string; process_type: string; created_at: string }[] | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map(({ iwo_fabric_boms, process_orders, ...r }) => {
    // A one-to-one embed can arrive as an object or a one-element array
    // depending on how PostgREST resolves it; survive both.
    const b = Array.isArray(iwo_fabric_boms) ? (iwo_fabric_boms[0] ?? null) : iwo_fabric_boms;
    return {
      ...r,
      dyeing_orders: (process_orders ?? [])
        .filter((p) => p.process_type === "dyeing")
        .sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map(({ id, code, status }) => ({ id, code, status })),
      bom: b
        ? {
            ...b,
            iwo_fabric_bom_palette: [...(b.iwo_fabric_bom_palette ?? [])].sort((x, y) => x.sno - y.sno),
            iwo_fabric_bom_dias: [...(b.iwo_fabric_bom_dias ?? [])].sort((x, y) => x.sno - y.sno),
            iwo_fabric_bom_lines: [...(b.iwo_fabric_bom_lines ?? [])].sort((x, y) => x.sno - y.sno),
            iwo_fabric_bom_processes: [...(b.iwo_fabric_bom_processes ?? [])].sort(
              (x, y) => x.item_id.localeCompare(y.item_id) || x.sno - y.sno,
            ),
            iwo_fabric_bom_yarns: [...(b.iwo_fabric_bom_yarns ?? [])]
              .sort((x, y) => x.sno - y.sno)
              .map((y) => ({
                ...y,
                iwo_fabric_bom_yarn_stages: [...(y.iwo_fabric_bom_yarn_stages ?? [])].sort(
                  (a, c) => a.sno - c.sno,
                ),
                iwo_fabric_bom_yarn_shades: [...(y.iwo_fabric_bom_yarn_shades ?? [])].sort(
                  (a, c) => a.sno - c.sno,
                ),
              })),
            iwo_fabric_bom_yd_repeats: [...(b.iwo_fabric_bom_yd_repeats ?? [])].sort(
              (x, y) => x.item_id.localeCompare(y.item_id) || x.sno - y.sno,
            ),
            // No `sno` on a combination (0581) and one `created_at` per save, so
            // they come back in stored order — the order screen reads its own
            // the same way. The colours carry their own `sno`.
            iwo_fabric_bom_yd_combinations: [...(b.iwo_fabric_bom_yd_combinations ?? [])].map((c) => ({
              ...c,
              iwo_fabric_bom_yd_combination_colors: [...(c.iwo_fabric_bom_yd_combination_colors ?? [])].sort(
                (a, d) => a.sno - d.sno,
              ),
            })),
          }
        : null,
    };
  });
  const swoByIwo = await swosOf(supabase, rows.map((r) => r.id));
  return withCreators(rows.map((r) => ({ ...r, swo: swoByIwo.get(r.id) ?? null })));
}

/**
 * EACH WORK ORDER'S SWO, in one read (0707). A failed read THROWS — a plan
 * shown without its SWO would offer no SMP picker while the action still
 * owes one on every line.
 */
async function swosOf(s: Db, iwoIds: string[]): Promise<Map<string, IwoSwo>> {
  const out = new Map<string, IwoSwo>();
  if (!iwoIds.length) return out;
  const { data, error } = await s
    .from("sample_product_groups")
    .select(
      "id, group_code, iwo_id, " +
        "items:sample_group_items(style_id, fabric_structure_id, calculated_weight_kg, created_at, " +
        "style:styles!style_id(sample_no, name), opp:opportunities!sample_entry_id(code))",
    )
    .in("iwo_id", iwoIds);
  if (error) throw new Error(`IWO Fabric Plan: could not read the SWOs: ${error.message}`);
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  type Row = {
    id: string;
    group_code: string;
    iwo_id: string;
    items:
      | {
          style_id: string;
          fabric_structure_id: string | null;
          calculated_weight_kg: number | string | null;
          created_at: string;
          style: One<{ sample_no: string | null; name: string | null }>;
          opp: One<{ code: string | null }>;
        }[]
      | null;
  };
  for (const g of (data ?? []) as unknown as Row[]) {
    // A style batched in two fabrics is two items of one SWO — one SMP pick.
    const seen = new Map<string, IwoSwoSample>();
    for (const it of [...(g.items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const kg = Number(it.calculated_weight_kg ?? 0) || 0;
      const held = seen.get(it.style_id);
      if (held) {
        held.kg = Math.round((held.kg + kg) * 1000) / 1000;
        if (it.fabric_structure_id && !held.structure_ids.includes(it.fabric_structure_id)) held.structure_ids.push(it.fabric_structure_id);
        continue;
      }
      const st = one(it.style);
      seen.set(it.style_id, {
        style_id: it.style_id,
        smp_no: one(it.opp)?.code ?? null,
        sample_no: st?.sample_no ?? null,
        style_name: st?.name ?? "",
        kg,
        structure_ids: it.fabric_structure_id ? [it.fabric_structure_id] : [],
      });
    }
    out.set(g.iwo_id, { id: g.id, code: g.group_code, samples: [...seen.values()] });
  }
  return out;
}

/**
 * What the Fabric Allocation / Fabric Consumption pickers offer.
 *
 * BUILT ON THE IWO SCREEN'S OWN LOADER (`getIwoFormData`), not a second copy of
 * it: which categories are FABRIC structures and which items are FABRIC is
 * decided there once, and the two screens name the same cloths. The one fact
 * that loader does not carry is each fabric's TYPE (Solid / Melange / Yarn
 * Dyed), which decides whether Mixing Uom is owed — added here by one query.
 */
export type IwoFabricBomFabricOption = IwoFabricOption & { fabric_type: string | null };

export type IwoFabricBomFormData = {
  structures: IwoStructureOption[];
  fabrics: IwoFabricBomFabricOption[];
  /** The YARN master (step 4, For = Yarn) — the IWO screen's own list, inactive carried. */
  yarns: PickerRow[];
  uoms: PickerRow[];
  fabricStages: ConfigLookup[];
  /** Fabric Process (step 3) — the master WHOLE, with its kind flags, exactly
   *  as the order screen receives it; see the import note. */
  processes: FabricProcessOption[];
  processLookups: FabricProcessLookups;
  /** Yarn Process (step 3) — the same master, carrying `for_yarn`. */
  yarnProcesses: YarnProcessOption[];
  /** config_lookups kind `yarn_stage` — GREY / DYED. */
  yarnStages: ConfigLookup[];
  /** The unit a Req Wt is in, and a yarn weight after it. Null when the UOM
   *  master has no active KGS row — the yarn weights then refuse by name. */
  kgUom: { id: string; decimals: number | null } | null;
};

export async function getIwoFabricBomFormData(): Promise<IwoFabricBomFormData> {
  const [base, s, processes, processLookups] = await Promise.all([
    getIwoFormData(),
    createClient(),
    getFabricProcessRows(),
    getFabricProcessLookupRows(),
  ]);
  const [yarnProcesses, yarnStages, kgUom] = await Promise.all([
    getYarnProcessRows(s),
    getYarnStageRows(s),
    kgUomOf(s),
  ]);
  // `items` has several foreign keys to `config_lookups`, so the embed names
  // its column (AGENTS.md, "A second FK breaks every existing embed").
  const { data, error } = await s
    .from("items")
    .select("id, fabric_type:config_lookups!fabric_type_id(name)")
    .not("fabric_type_id", "is", null);
  if (error) throw new Error(`IWO Fabric Plan: ${error.message}`);

  // The embed can arrive as an object or a one-element array; read both — a
  // cast to one shape silently disabled the order screen's Type rule once.
  type Named = { name: string | null };
  const nameOf = (v: Named | Named[] | null | undefined) =>
    Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null);
  const typeById = new Map(
    ((data ?? []) as unknown as { id: string; fabric_type: Named | Named[] | null }[]).map((r) => [
      r.id,
      nameOf(r.fabric_type),
    ]),
  );

  return {
    structures: base.structures,
    fabrics: base.fabrics.map((f) => ({ ...f, fabric_type: typeById.get(f.id) ?? null })),
    yarns: base.yarns,
    uoms: base.uoms,
    fabricStages: base.fabricStages,
    processes,
    processLookups,
    yarnProcesses,
    yarnStages,
    kgUom,
  };
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** THE ORDER SERVICE'S OWN LOADER, not a copy any more (2026-09-21). It was a
 *  copy without `stage_roles`, so on this screen every yarn process read as
 *  unclassified and the Stage → Process rule silently fell open — the gap
 *  screenshot 2973 caught on Fabric BOM, one screen over. One loader, both
 *  screens, so the yarn tab answers a Stage the same way everywhere. */
async function getYarnProcessRows(_s: Db): Promise<YarnProcessOption[]> {
  return loadYarnProcessRows();
}

async function getYarnStageRows(s: Db): Promise<ConfigLookup[]> {
  const { data, error } = await s
    .from("config_lookups")
    .select("id, kind, code, name, notes, is_active")
    .eq("kind", "yarn_stage")
    .order("name");
  if (error) throw new Error(`Could not load the yarn stages: ${error.message}`);
  return (data ?? []) as unknown as ConfigLookup[];
}

/** The KGS row and its decimals — `kilogramUom` decides which row is KGS, the
 *  same helper every KG-denominated writer in the app uses. */
export async function kgUomOf(s: Db): Promise<{ id: string; decimals: number | null } | null> {
  const kg = await kilogramUom(s);
  if (!kg) return null;
  const { data } = await s.from("uoms").select("decimal_places_allowed").eq("id", kg.id).single();
  return { id: kg.id, decimals: (data as { decimal_places_allowed: number | null } | null)?.decimal_places_allowed ?? null };
}
