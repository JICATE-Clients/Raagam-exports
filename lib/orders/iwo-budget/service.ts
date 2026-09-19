import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stageRank } from "@/lib/orders/fabric-bom/stage-routes";
import { kgUomOf } from "@/lib/orders/iwo-fabric-bom/service";
import { pullIwoLines, type IwoPullInput, type IwoPullResult, type IwoPullYarn } from "./pull";

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
              "shades:iwo_fabric_bom_yarn_shades(sno, color_name, purchase_qty), " +
              "stages:iwo_fabric_bom_yarn_stages(sno, stage_id, process_id, combo, process_qty, uom_id, refusal_reason))",
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

  // The process master's kind flags for the fabric routes — READ, never
  // coalesced from a failure (the IWO Fabric BOM action's rule).
  const procIds = [...new Set((f?.processes ?? []).map((p) => p.process_id).filter(Boolean))] as string[];
  const processKinds = new Map<string, { is_knitting: boolean; is_dyeing: boolean }>();
  if (procIds.length) {
    const { data, error } = await s.from("processes").select("id, is_knitting, is_dyeing").in("id", procIds);
    if (error) return { refused: `Could not read the process master: ${error.message}` };
    for (const r of (data ?? []) as { id: string; is_knitting: boolean | null; is_dyeing: boolean | null }[]) {
      processKinds.set(r.id, { is_knitting: r.is_knitting ?? false, is_dyeing: r.is_dyeing ?? false });
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
