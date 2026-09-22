import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stageRank } from "@/lib/orders/fabric-bom/stage-routes";
import { kgUomOf } from "@/lib/orders/iwo-fabric-bom/service";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocationId } from "@/lib/auth/location";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import { pullIwoLines, type IwoPullInput, type IwoPullResult, type IwoPullYarn } from "./pull";
import type { IwoBudget } from "./types";

/**
 * IWO Budget — reads what `pull.ts` needs, straight from the stored BOMs.
 *
 * READ AS STORED, NEVER RE-SAVED: the purchase and process weights are the
 * ones each BOM's own Save computed (0581 / 0584 / 0592), so the budget and
 * the BOM cannot disagree about a weight. A DRAFT BOM is refused by the pull,
 * not filtered here, so the operator is told why nothing came.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md): an empty pull
 * would read as "this BOM costs nothing".
 */

type Named = { name: string | null };
const nameOf = (v: Named | Named[] | null | undefined) => (Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null));

export async function loadIwoPullInput(iwoId: string): Promise<IwoPullInput | { refused: string }> {
  const s = await createClient();
  const { data: iwo, error: iwoErr } = await s
    .from("internal_work_orders")
    .select("id, iwo_for")
    .eq("id", iwoId)
    .maybeSingle();
  if (iwoErr) return { refused: `Could not read the work order: ${iwoErr.message}` };
  const iwoFor = (iwo as { iwo_for: string } | null)?.iwo_for;
  if (iwoFor !== "yarn" && iwoFor !== "fabric" && iwoFor !== "accessories") {
    return { refused: "No Internal Work Order to budget." };
  }

  const [fab, mat, stages, kg] = await Promise.all([
    iwoFor === "accessories"
      ? Promise.resolve({ data: null, error: null })
      : s
          .from("iwo_fabric_boms")
          .select(
            "is_draft, " +
              "lines:iwo_fabric_bom_lines(item_id, req_kgs), " +
              "processes:iwo_fabric_bom_processes(item_id, sno, stage_id, process_id, loss_pct), " +
              "yarns:iwo_fabric_bom_yarns(item_id, purchase_qty, uom_id, refusal_reason, buy_stage_id, colour_by, " +
              // `planned_kgs`, `loss_pct`, `color_losses` (0613): what the pull
              // re-runs a covering dyeing step's per-shade split from.
              "shades:iwo_fabric_bom_yarn_shades(sno, color_name, planned_kgs, purchase_qty), " +
              "stages:iwo_fabric_bom_yarn_stages(sno, stage_id, process_id, combo, loss_pct, color_losses, process_qty, uom_id, refusal_reason))",
          )
          .eq("iwo_id", iwoId)
          .maybeSingle(),
    iwoFor !== "accessories"
      ? Promise.resolve({ data: null, error: null })
      : s
          .from("iwo_material_boms")
          .select(
            "is_draft, " +
              "items:iwo_material_bom_items(item_id, required_qty, consumption_uom_id, specification, is_foc, refusal_reason, sno, " +
              "color:config_lookups!item_color_id(name)), " +
              "processes:iwo_material_bom_processes(item_id, process_id, sno)",
          )
          .eq("iwo_id", iwoId)
          .maybeSingle(),
    s.from("config_lookups").select("id, code, name").eq("kind", "yarn_stage"),
    kgUomOf(s),
  ]);
  if (fab.error) return { refused: `Could not read the Fabric BOM: ${fab.error.message}` };
  if (mat.error) return { refused: `Could not read the Material BOM: ${mat.error.message}` };
  if (stages.error) return { refused: `Could not read the yarn stages: ${stages.error.message}` };

  type RawYarn = Omit<IwoPullYarn, "shades"> & { shades: (IwoPullYarn["shades"][number] & { sno: number })[] };
  const f = fab.data as unknown as {
    is_draft: boolean;
    lines: { item_id: string; req_kgs: number | null }[];
    processes: { item_id: string; sno: number; stage_id: string | null; process_id: string | null; loss_pct: number | null }[];
    yarns: RawYarn[];
  } | null;
  const m = mat.data as unknown as {
    is_draft: boolean;
    items: {
      item_id: string;
      required_qty: number | null;
      consumption_uom_id: string | null;
      specification: string | null;
      is_foc: boolean;
      refusal_reason: string | null;
      sno: number;
      color: Named | Named[] | null;
    }[];
    processes: { item_id: string; process_id: string; sno: number }[];
  } | null;

  // The process master's kind flags for the fabric routes AND the yarn steps
  // — READ, never coalesced from a failure (the IWO Fabric BOM action's rule).
  // `is_cloth_purchase` (2026-09-21) is what keeps a purchase step off
  // Process Rates on both sides; see `pullIwoLines`.
  const procIds = [
    ...new Set([
      ...(f?.processes ?? []).map((p) => p.process_id),
      ...(f?.yarns ?? []).flatMap((y) => (y.stages ?? []).map((st) => st.process_id)),
    ]),
  ].filter((id): id is string => !!id);
  const processKinds = new Map<string, { is_knitting: boolean; is_dyeing: boolean; is_cloth_purchase: boolean }>();
  if (procIds.length) {
    const { data, error } = await s
      .from("processes")
      .select("id, is_knitting, is_dyeing, is_cloth_purchase")
      .in("id", procIds);
    if (error) return { refused: `Could not read the process master: ${error.message}` };
    for (const r of (data ?? []) as {
      id: string;
      is_knitting: boolean | null;
      is_dyeing: boolean | null;
      is_cloth_purchase: boolean | null;
    }[]) {
      processKinds.set(r.id, {
        is_knitting: r.is_knitting ?? false,
        is_dyeing: r.is_dyeing ?? false,
        is_cloth_purchase: r.is_cloth_purchase ?? false,
      });
    }
  }

  const itemIds = [
    ...new Set([
      ...(f?.yarns ?? []).map((y) => y.item_id),
      ...(f?.lines ?? []).map((l) => l.item_id),
      ...(m?.items ?? []).map((i) => i.item_id),
    ]),
  ];
  const names = new Map<string, string>();
  if (itemIds.length) {
    const { data, error } = await s.from("items").select("id, name").in("id", itemIds);
    if (error) return { refused: `Could not read the item master: ${error.message}` };
    for (const r of (data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  }

  const bySno = <T extends { sno: number }>(xs: readonly T[] | null | undefined) => [...(xs ?? [])].sort((a, b) => a.sno - b.sno);

  return {
    iwoFor,
    fabricBom: f
      ? {
          is_draft: f.is_draft,
          lines: f.lines ?? [],
          processes: bySno(f.processes),
          yarns: (f.yarns ?? []).map((y) => ({ ...y, shades: bySno(y.shades), stages: y.stages ?? [] })),
        }
      : null,
    materialBom: m
      ? {
          is_draft: m.is_draft,
          items: bySno(m.items).map((i) => ({
            item_id: i.item_id,
            color_name: nameOf(i.color),
            required_qty: i.required_qty,
            consumption_uom_id: i.consumption_uom_id,
            specification: i.specification,
            is_foc: i.is_foc,
            refusal_reason: i.refusal_reason,
          })),
          processes: bySno(m.processes),
        }
      : null,
    kgUomId: kg?.id ?? null,
    greyYarnStageId:
      ((stages.data ?? []) as { id: string; code: string | null; name: string }[]).find((st) => stageRank(st) === 0)
        ?.id ?? null,
    processKinds,
    name: (id) => names.get(id) ?? "(item not in the master)",
  };
}

/** The pull, end to end: the stored BOM → budget lines (or why not). */
export async function pullIwoCostLines(iwoId: string): Promise<IwoPullResult> {
  const input = await loadIwoPullInput(iwoId);
  if ("refused" in input) return input;
  return pullIwoLines(input);
}

// ---------------------------------------------------------------------------
// The screen (Phase 4)
// ---------------------------------------------------------------------------

/**
 * ONE ROW PER WORK ORDER AT THIS UNIT, with its budget when it has one and its
 * BOM's state (the pull needs a saved BOM). The IWO BOM screens' task-queue
 * shape (`listIwoFabricBomTasks`), every For at once.
 *
 * SCOPED TO THE CURRENT UNIT: the budget header is (RLS `is_current_location`)
 * and the IWO table is not, so an unscoped list would show another unit's
 * work order with its budget invisible.
 */
export type IwoBudgetTask = {
  id: string;
  code: string | null;
  iwo_date: string;
  iwo_for: IwoFor;
  /** Reference (RE No), typed on the work order (0597). */
  reference_no: string | null;
  deli_date: string | null;
  created_by: string | null;
  created_at: string;
  /** The BOM this For uses: absent, draft, or saved. */
  bom: "none" | "draft" | "saved";
  budget: IwoBudget | null;
};

export async function listIwoBudgetTasks(): Promise<IwoBudgetTask[]> {
  const locationId = await getCurrentLocationId();
  if (!locationId) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("internal_work_orders")
    .select(
      "id, code, iwo_date, iwo_for, reference_no, deli_date, created_by, created_at, " +
        "iwo_fabric_boms(id, is_draft), iwo_material_boms(id, is_draft), " +
        "iwo_budgets(id, code, iwo_id, budget_date, status, decision_remark, remark, created_by, created_at, iwo_budget_lines(*))",
    )
    .eq("location_id", locationId)
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  if (error) throw new Error(`IWO Budget: ${error.message}`);

  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  type Raw = Omit<IwoBudgetTask, "bom" | "budget"> & {
    iwo_fabric_boms: One<{ is_draft: boolean }>;
    iwo_material_boms: One<{ is_draft: boolean }>;
    iwo_budgets: One<IwoBudget>;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map(({ iwo_fabric_boms, iwo_material_boms, iwo_budgets, ...r }) => {
    const bom = r.iwo_for === "accessories" ? one(iwo_material_boms) : one(iwo_fabric_boms);
    const b = one(iwo_budgets);
    return {
      ...r,
      bom: !bom ? ("none" as const) : bom.is_draft ? ("draft" as const) : ("saved" as const),
      budget: b ? { ...b, iwo_budget_lines: [...(b.iwo_budget_lines ?? [])].sort((x, y) => x.sno - y.sno) } : null,
    };
  });
  return withCreators(rows);
}

export type IwoBudgetPickerRow = { id: string; code: string | null; name: string; is_active?: boolean | null; inactive?: boolean | null };
export type IwoBudgetFormData = {
  /** Yarn, fabric and accessory items — `klass` decides which grid offers each. */
  items: (IwoBudgetPickerRow & { klass: string | null })[];
  uoms: IwoBudgetPickerRow[];
  processes: (IwoBudgetPickerRow & { for_yarn: boolean; for_fabric: boolean; for_trims: boolean })[];
  currencies: { code: string; name: string | null }[];
  /** `yarn_stage`, `fabric_stage`, `expense_head` — filter by `kind` at the use site. */
  lookups: { id: string; kind: string; code: string | null; name: string; is_active: boolean | null }[];
};

/** The pickers. Inactive rows are CARRIED (never filtered in SQL): a value a
 *  line already holds must still resolve (AGENTS.md, "Disabled rows"). */
export async function getIwoBudgetFormData(): Promise<IwoBudgetFormData> {
  const s = await createClient();
  const [items, uoms, processes, currencies, lookups] = await Promise.all([
    // `items` has several FKs to config_lookups — the embed names its column.
    s.from("items").select("id, code, name, is_active, klass:config_lookups!item_class_id(code)").order("name"),
    s.from("uoms").select("id, code, name, is_active").order("code"),
    s.from("processes").select("id, name, inactive, for_yarn, for_fabric, for_trims").order("name"),
    s.from("currencies").select("code, name").order("code"),
    s
      .from("config_lookups")
      .select("id, kind, code, name, is_active")
      .in("kind", ["yarn_stage", "fabric_stage", "expense_head"])
      .order("name"),
  ]);
  for (const r of [items, uoms, processes, currencies, lookups]) {
    if (r.error) throw new Error(`IWO Budget: ${r.error.message}`);
  }
  const wanted = new Set(["YARN", "FABRIC", "SEW", "PACK"]);
  type ItemRaw = IwoBudgetPickerRow & { klass: Named | Named[] | null };
  const codeOf = (v: { code: string | null } | { code: string | null }[] | null) =>
    (Array.isArray(v) ? v[0]?.code : v?.code)?.toUpperCase() ?? null;
  return {
    items: ((items.data ?? []) as unknown as (Omit<ItemRaw, "klass"> & { klass: { code: string | null } | { code: string | null }[] | null })[])
      .map((i) => ({ ...i, klass: codeOf(i.klass) }))
      .filter((i) => i.klass && wanted.has(i.klass)),
    uoms: (uoms.data ?? []) as IwoBudgetPickerRow[],
    processes: ((processes.data ?? []) as {
      id: string;
      name: string;
      inactive: boolean | null;
      for_yarn: boolean | null;
      for_fabric: boolean | null;
      for_trims: boolean | null;
    }[]).map((p) => ({
      id: p.id,
      code: null,
      name: p.name,
      inactive: p.inactive,
      for_yarn: !!p.for_yarn,
      for_fabric: !!p.for_fabric,
      for_trims: !!p.for_trims,
    })),
    currencies: (currencies.data ?? []) as { code: string; name: string | null }[],
    lookups: (lookups.data ?? []) as IwoBudgetFormData["lookups"],
  };
}
