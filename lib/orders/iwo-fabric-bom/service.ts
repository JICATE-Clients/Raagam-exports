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
import { getFabricProcessLookupRows, getFabricProcessRows } from "@/lib/orders/fabric-bom/service";
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
};

export async function listIwoFabricBomTasks(): Promise<IwoFabricBomTask[]> {
  const locationId = await getCurrentLocationId();
  if (!locationId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("internal_work_orders")
    .select(
      "id, code, iwo_date, iwo_for, reference_no, deli_date, remarks, status, created_by, created_at, " +
        "iwo_fabric_boms(*, iwo_fabric_bom_palette(*), iwo_fabric_bom_dias(*), iwo_fabric_bom_lines(*), " +
        "iwo_fabric_bom_processes(*), iwo_fabric_bom_yarns(*, iwo_fabric_bom_yarn_stages(*), iwo_fabric_bom_yarn_shades(*)))",
    )
    .in("iwo_for", ["yarn", "fabric"])
    .eq("location_id", locationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`IWO Fabric BOM: ${error.message}`);

  type Raw = Omit<IwoFabricBomTask, "bom"> & {
    iwo_fabric_boms: IwoFabricBom | IwoFabricBom[] | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map(({ iwo_fabric_boms, ...r }) => {
    // A one-to-one embed can arrive as an object or a one-element array
    // depending on how PostgREST resolves it; survive both.
    const b = Array.isArray(iwo_fabric_boms) ? (iwo_fabric_boms[0] ?? null) : iwo_fabric_boms;
    return {
      ...r,
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
          }
        : null,
    };
  });
  return withCreators(rows);
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
  if (error) throw new Error(`IWO Fabric BOM: ${error.message}`);

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

/** Copied from the order service's private `getYarnProcessRows` — the Process
 *  master with `for_yarn`, `inactive` carried (never filtered) so a held value
 *  still resolves. A failed query is an error, not an empty list. */
async function getYarnProcessRows(s: Db): Promise<YarnProcessOption[]> {
  const { data, error } = await s.from("processes").select("id, name, inactive, for_yarn").order("name");
  if (error) throw new Error(`Could not load the Process master: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null; for_yarn: boolean | null }[]).map(
    (p) => ({ id: p.id, code: null, name: p.name, inactive: p.inactive ?? false, for_yarn: p.for_yarn ?? false }),
  );
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
