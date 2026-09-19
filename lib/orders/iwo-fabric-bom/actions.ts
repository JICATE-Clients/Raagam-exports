"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import { iwoFabricBomInput, type IwoFabricBomInput, type IwoFabricBomParsed } from "./types";
import {
  iwoFabricLineProblems,
  iwoFabricStages,
  iwoGreigeRouteProblems,
  iwoShadeTotal,
  iwoYarnLineProblems,
  keptIwoFabricLines,
  keptIwoYarnLines,
  keptIwoYarnShades,
} from "./lines";
import { iwoFabricGross, iwoRoutesByFabric, iwoYarnModePurchase } from "./yarn";
import { kgUomOf } from "./service";
// The ORDER Fabric BOM's pure engine and its order-agnostic loaders, reused as
// they are — see yarn.ts for why the IWO must not compute a yarn weight any
// other way. Nothing here edits the order module.
import {
  comboKey,
  isRefusal,
  stageProblem,
  stageProcessQty,
  yarnPurchase,
  yarnStageStarted,
  type FabricComposition,
} from "@/lib/orders/fabric-bom/yarn-process";
import { colouredStageIds, stageRank, stageRouteProblems } from "@/lib/orders/fabric-bom/stage-routes";
import { isYarnDyed } from "@/lib/orders/fabric-bom/fabric-line-rules";
import {
  getBomYarnComposition,
  getFabricProcessLookupRows,
  getFabricProcessRows,
  getYarnStageRows,
} from "@/lib/orders/fabric-bom/service";

type Result = { ok: true; bomId: string } | { ok: false; error: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const PATH = "/orders/iwo-fabric-bom";

/**
 * Rewrite each child list the payload CARRIES; leave any it omits alone (see
 * types.ts). Delete-then-insert, the order screen's own write shape — the
 * child tables hold nothing a row id is cited by.
 */
async function writeChildren(
  s: Db,
  bomId: string,
  p: IwoFabricBomParsed,
  mode: "yarn" | "fabric",
  facts: YarnModeFacts | null,
) {
  if (p.palette) {
    const { error: d } = await s.from("iwo_fabric_bom_palette").delete().eq("bom_id", bomId);
    if (d) return d.message;
    // `sno` runs within each panel, in screen order.
    const bySection: Record<string, number> = {};
    const rows = p.palette.map((r) => ({
      bom_id: bomId,
      section: r.section,
      name: r.name,
      sno: (bySection[r.section] = (bySection[r.section] ?? 0) + 1),
    }));
    if (rows.length) {
      const { error } = await s.from("iwo_fabric_bom_palette").insert(rows);
      if (error) {
        return error.code === "23505"
          ? "The same name appears twice in one colour/print panel — remove the repeat."
          : error.message;
      }
    }
  }
  if (p.dias) {
    const { error: d } = await s.from("iwo_fabric_bom_dias").delete().eq("bom_id", bomId);
    if (d) return d.message;
    const rows = p.dias
      .filter((r) => r.knit_type || r.dia)
      .map((r, i) => ({ bom_id: bomId, sno: i + 1, knit_type: r.knit_type, dia: r.dia || null }));
    if (rows.length) {
      const { error } = await s.from("iwo_fabric_bom_dias").insert(rows);
      if (error) return error.message;
    }
  }
  if (p.lines) {
    // Nothing is keyed to a line id — the Fabric Process route and Yarn Dyed
    // Details key to the FABRIC (0581) — so delete-then-insert loses nothing.
    const { error: d } = await s.from("iwo_fabric_bom_lines").delete().eq("bom_id", bomId);
    if (d) return d.message;
    const rows = keptIwoFabricLines(p.lines).map((l, i) => ({
      bom_id: bomId,
      sno: i + 1,
      structure_id: l.structure_id,
      item_id: l.item_id,
      color_name: l.color_name || null,
      fabric_form: l.fabric_form,
      mixing_uom_id: l.mixing_uom_id,
      no_of_colors: l.no_of_colors,
      gsm: l.gsm,
      finish_dia: l.finish_dia || null,
      stage_id: l.stage_id,
      req_kgs: l.req_kgs,
    }));
    if (rows.length) {
      const { error } = await s.from("iwo_fabric_bom_lines").insert(rows);
      if (error) {
        // 0581's item guard: a line that names something other than a FABRIC.
        if (error.code === "23514") return "A fabric line names an item that is not a fabric.";
        // 0592's (fabric, colour, dia) index — `lines.ts` says it first, by row.
        if (error.code === "23505") return "The same fabric, colour and dia are on two lines — put the weight on one line.";
        return error.message;
      }
    }
  }
  if (p.processes) {
    // A route is kept only for a fabric still on a line, and only its steps
    // that name a process — the order action's `normalizeProcesses`, minus the
    // colourway/component axes an IWO does not have. `sno` runs per fabric.
    const fabricIds = await fabricIdsOf(s, bomId, p);
    const { error: d } = await s.from("iwo_fabric_bom_processes").delete().eq("bom_id", bomId);
    if (d) return d.message;
    const nextSno = new Map<string, number>();
    const rows = p.processes
      .filter((r) => r.process_id && fabricIds.has(r.item_id))
      .map((r) => {
        const sno = (nextSno.get(r.item_id) ?? 0) + 1;
        nextSno.set(r.item_id, sno);
        return {
          bom_id: bomId,
          item_id: r.item_id,
          sno,
          stage_id: r.stage_id,
          process_id: r.process_id,
          loss_for_id: r.loss_for_id,
          loss_pct: r.loss_pct,
          type_id: r.type_id,
        };
      });
    if (rows.length) {
      const { error } = await s.from("iwo_fabric_bom_processes").insert(rows);
      if (error) return error.message;
    }
  }
  if (p.yarns) {
    const err = await writeYarns(s, bomId, p, mode, facts);
    if (err) return err;
  }
  return null;
}

/** The fabrics this BOM's lines name — the payload's when it carries lines,
 *  else the stored ones (a save that did not send lines left them standing). */
async function fabricIdsOf(s: Db, bomId: string, p: IwoFabricBomParsed): Promise<Set<string>> {
  if (p.lines) return new Set(keptIwoFabricLines(p.lines).map((l) => l.item_id));
  const { data } = await s.from("iwo_fabric_bom_lines").select("item_id").eq("bom_id", bomId);
  return new Set(((data ?? []) as { item_id: string }[]).map((r) => r.item_id));
}

/**
 * THE YARN PURCHASE, COMPUTED HERE AND STORED — never taken from the form
 * (the order BOM's rule: "written by the server, never by the form").
 *
 * The fabrics' gross is the typed Req Wt (`iwoFabricGross`); everything after
 * that is the order engine unchanged: blend share, the fabric's route (with its
 * Knitting/Dyeing kinds), the yarn's own stages, the KGS unit's rounding.
 *
 * NEEDS THE LINES AND THE ROUTE IN THE SAME PAYLOAD — the screen sends all
 * three together, and weighing today's yarns against yesterday's lines is the
 * preview-versus-stored split this module exists to prevent. So a payload with
 * yarns but no lines or processes is refused rather than half-computed.
 */
async function writeYarns(
  s: Db,
  bomId: string,
  p: IwoFabricBomParsed,
  mode: "yarn" | "fabric",
  facts: YarnModeFacts | null,
): Promise<string | null> {
  if (!p.yarns) return null;
  const kg = await kgUomOf(s);
  type Built = { row: Record<string, unknown>; stages: Record<string, unknown>[]; shades: Record<string, unknown>[] };
  const out: Built[] = [];

  /** One yarn's stored row and stages, from its kept stages and its weight
   *  (or the refusal standing in for it) — shared by both modes, so a stage's
   *  quantity is `stageProcessQty` over the same `byCombo` either way. */
  const build = (
    y: NonNullable<IwoFabricBomParsed["yarns"]>[number],
    kept: NonNullable<IwoFabricBomParsed["yarns"]>[number]["stages"],
    weight: ReturnType<typeof iwoYarnModePurchase>,
    extra: Record<string, unknown>,
    shades: Record<string, unknown>[] = [],
  ): Built => {
    const refused = isRefusal(weight);
    const byCombo = refused ? [] : weight.byCombo;
    return {
      shades,
      row: {
        bom_id: bomId,
        sno: out.length + 1,
        item_id: y.item_id,
        ...extra,
        ...(refused
          ? { purchase_qty: null, uom_id: null, refusal_reason: weight.refused }
          : { purchase_qty: weight.qty, uom_id: weight.uom_id, refusal_reason: null }),
      },
      stages: kept.map((st, i) => {
        const problem = refused ? weight.refused : st.process_id ? stageProblem(st.combo ?? null, byCombo) : null;
        return {
          sno: i + 1,
          stage_id: st.stage_id ?? null,
          process_id: st.process_id ?? null,
          loss_for_id: st.loss_for_id ?? null,
          combo: st.combo ?? null,
          description: st.description ?? null,
          loss_pct: st.loss_pct ?? null,
          ...(st.process_id && !problem
            ? { process_qty: stageProcessQty(st.combo ?? null, byCombo), uom_id: refused ? null : weight.uom_id, refusal_reason: null }
            : { process_qty: null, uom_id: null, refusal_reason: problem }),
        };
      }),
    };
  };

  const startedStages = (y: NonNullable<IwoFabricBomParsed["yarns"]>[number]) =>
    y.stages.filter((st) =>
      yarnStageStarted({
        stage_id: st.stage_id,
        process_id: st.process_id,
        loss_for_id: st.loss_for_id ?? null,
        combo: st.combo ?? "",
        description: st.description ?? "",
        loss_pct: st.loss_pct == null ? "" : String(st.loss_pct),
      }),
    );

  if (mode === "yarn") {
    // FOR = YARN (step 4): the yarns are PICKED and weighed; each one's
    // purchase is its Planned Weight through its own stages. The line rules
    // were run before anything was written (see `yarnLineProblem`).
    const kept = keptIwoYarnLines(p.yarns.map((y) => ({ ...y, hasStages: startedStages(y).length > 0 })));
    const ids = [...new Set(kept.map((y) => y.item_id).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    if (ids.length) {
      const { data } = await s.from("items").select("id, name").in("id", ids);
      for (const r of (data ?? []) as { id: string; name: string }[]) nameById.set(r.id, r.name);
    }
    for (const y of kept) {
      const stages = startedStages(y);
      // GREY or DYED (0592) — read off the stage master, never the payload's
      // say-so. A DYED yarn's weight is its shades; `colour_by` is kept only
      // there, so a line switched back to GREY cannot leave a stale one behind.
      const dyed = !!y.buy_stage_id && !!facts?.dyedStages.has(y.buy_stage_id);
      const shades = dyed ? keptIwoYarnShades(y.shades) : [];
      const weight = iwoYarnModePurchase(
        dyed ? null : y.planned_kgs,
        stages.map((st) => ({ combo: st.combo ?? null, loss_pct: st.loss_pct ?? null })),
        kg?.id ?? null,
        kg?.decimals ?? null,
        nameById.get(y.item_id) ?? "this yarn",
        dyed
          ? {
              colourBy: y.colour_by,
              shades: shades.map((sh) => ({ color_name: sh.color_name ?? "", planned_kgs: sh.planned_kgs })),
            }
          : null,
      );
      const shadeQty = isRefusal(weight) ? undefined : weight.shadeQty;
      out.push(
        build(
          y,
          stages,
          weight,
          {
            planned_kgs: dyed ? iwoShadeTotal(shades) : y.planned_kgs,
            buy_stage_id: y.buy_stage_id,
            colour_by: dyed ? y.colour_by : null,
          },
          shades.map((sh, i) => ({
            sno: i + 1,
            color_name: sh.color_name,
            planned_kgs: sh.planned_kgs,
            purchase_qty: shadeQty?.[comboKey(sh.color_name)] ?? null,
          })),
        ),
      );
    }
  } else {
    if (!p.lines || !p.processes) {
      return "The yarn weights need the fabric lines and their routes in the same save — reopen the BOM and save again.";
    }
    const lines = keptIwoFabricLines(p.lines);
    const fabricIds = [...new Set(lines.map((l) => l.item_id))];
    const { compositions } = await getBomYarnComposition(fabricIds);
    const compById = new Map<string, FabricComposition>(compositions.map((c) => [c.fabric_id, c]));
    const nameOf = (id: string) => compById.get(id)?.fabric_name || "this fabric";
    const gross = iwoFabricGross(lines, kg?.id ?? null, nameOf);

    // The process master's kind flags — READ, never coalesced from a failure: a
    // failed read would make every step "neither kind" and silently change what
    // a purchased cloth suppresses (the order action's `processKindsOf`).
    const procIds = [...new Set(p.processes.map((r) => r.process_id).filter(Boolean))] as string[];
    const kinds = new Map<string, { is_knitting: boolean; is_dyeing: boolean }>();
    if (procIds.length) {
      const { data, error } = await s.from("processes").select("id, is_knitting, is_dyeing").in("id", procIds);
      if (error) return `Could not read the process master's kind flags: ${error.message}`;
      for (const r of (data ?? []) as { id: string; is_knitting: boolean | null; is_dyeing: boolean | null }[]) {
        kinds.set(r.id, { is_knitting: r.is_knitting ?? false, is_dyeing: r.is_dyeing ?? false });
      }
    }
    const routes = iwoRoutesByFabric(
      p.processes.filter((r) => fabricIds.includes(r.item_id)),
      kinds,
    );

    // A yarn row exists because a cloth on this BOM is MADE of it. The payload
    // arriving empty while the cloths declare yarns means the screen had not
    // finished deriving the list — refused BEFORE the delete, keeping what is
    // stored (the order action's own guard).
    const declared = new Set(compositions.flatMap((c) => c.components.map((x) => x.yarn_id).filter(Boolean)));
    const sent = p.yarns.filter((y) => declared.has(y.item_id));
    if (sent.length === 0 && declared.size > 0) {
      return (
        "The yarn rows had not finished loading, so this save could not work out the yarn purchase — " +
        "the previously saved figures have been kept. Reopen the BOM, wait for Yarn Process to fill in, and save again."
      );
    }
    const seen = new Set<string>();
    for (const y of sent) {
      if (seen.has(y.item_id)) continue;
      seen.add(y.item_id);
      const stages = startedStages(y);
      const weight = yarnPurchase(
        y.item_id,
        gross,
        compById,
        routes,
        stages.map((st) => ({ combo: st.combo ?? null, loss_pct: st.loss_pct ?? null })),
        kg?.decimals ?? null,
        // Every IWO fabric is knitted from yarn (the order screen's Source
        // control is hidden, so its default is the only answer), and no
        // yarn-dyed shade losses are recorded yet — the same two arguments the
        // preview passes.
        new Map(),
        [],
      );
      out.push(build(y, stages, weight, { planned_kgs: null, buy_stage_id: null }));
    }
  }

  // Stages go with their yarns by cascade (they carry `yarn_id`, not `bom_id`).
  const { error: clearErr } = await s.from("iwo_fabric_bom_yarns").delete().eq("bom_id", bomId);
  if (clearErr) return clearErr.message;
  if (out.length === 0) return null;

  const { data: inserted, error } = await s
    .from("iwo_fabric_bom_yarns")
    .insert(out.map((y) => y.row))
    .select("id, sno");
  if (error) {
    if (error.code === "23514") return "A yarn row names an item that is not a yarn.";
    if (error.code === "23505") return "A yarn is listed twice — plan it once.";
    return error.message;
  }
  const bySno = new Map(((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
  const stageRows = out.flatMap((y) =>
    y.stages.map((st) => ({ ...st, yarn_id: bySno.get(y.row.sno as number) })),
  );
  if (stageRows.some((r) => !r.yarn_id)) return "Could not read back the saved yarns.";
  if (stageRows.length) {
    const { error: stErr } = await s.from("iwo_fabric_bom_yarn_stages").insert(stageRows);
    if (stErr) return stErr.message;
  }
  const shadeRows = out.flatMap((y) => y.shades.map((sh) => ({ ...sh, yarn_id: bySno.get(y.row.sno as number) })));
  if (shadeRows.length) {
    const { error: shErr } = await s.from("iwo_fabric_bom_yarn_shades").insert(shadeRows);
    if (shErr) return shErr.code === "23505" ? "A shade is listed twice on one yarn — plan it once." : shErr.message;
  }
  return null;
}

/**
 * THE TWO MASTER FACTS THE YARN LINE RULES NEED (0592), read once per save:
 * which `yarn_stage` rows are DYED (`colouredStageIds` — `stageRank`, the
 * Fabric BOM's own test, never the word compared here) and which processes
 * DYE (`is_dyeing`). A failed read REFUSES the save: an empty set would read
 * every DYED yarn as GREY, or every dyeing step as not one, and quietly
 * waive the shade rules.
 */
type YarnModeFacts = { dyedStages: Set<string>; dyeingProcesses: Set<string> };

async function yarnModeFactsOf(s: Db, p: IwoFabricBomParsed): Promise<YarnModeFacts | string> {
  const stages = await getYarnStageRows();
  if (!stages.length) return "Could not read the yarn stages (GREY / DYED) — try again.";
  const procIds = [
    ...new Set((p.yarns ?? []).flatMap((y) => y.stages.map((st) => st.process_id)).filter(Boolean)),
  ] as string[];
  const dyeingProcesses = new Set<string>();
  if (procIds.length) {
    const { data, error } = await s.from("processes").select("id, is_dyeing").in("id", procIds);
    if (error) return `Could not read the process master: ${error.message}`;
    for (const r of (data ?? []) as { id: string; is_dyeing: boolean | null }[]) {
      if (r.is_dyeing) dyeingProcesses.add(r.id);
    }
  }
  return { dyedStages: colouredStageIds(stages), dyeingProcesses };
}

/** The Yarn Colour panel names — the payload's when it carries the palette
 *  (the screen always does), else the stored ones. */
async function yarnColoursOf(s: Db, bomId: string | null, p: IwoFabricBomParsed): Promise<string[]> {
  if (p.palette) return p.palette.filter((r) => r.section === "yarn").map((r) => r.name);
  if (!bomId) return [];
  const { data } = await s.from("iwo_fabric_bom_palette").select("name").eq("bom_id", bomId).eq("section", "yarn");
  return ((data ?? []) as { name: string }[]).map((r) => r.name);
}

/**
 * THE IWO'S FOR, READ FROM THE DATABASE — never taken from the screen. It decides
 * where a yarn's weight comes from (a fabric's Req Wt, or the yarn's own
 * Planned Weight), so a stale or forged payload must not be able to choose.
 */
async function iwoForOf(s: Db, iwoId: string): Promise<"yarn" | "fabric" | null> {
  const { data } = await s.from("internal_work_orders").select("iwo_for").eq("id", iwoId).single();
  const f = (data as { iwo_for: string | null } | null)?.iwo_for;
  return f === "yarn" || f === "fabric" ? f : null;
}

/** For = Yarn: the Yarn Lines rules (`lines.ts`), run again on the server —
 *  the stage and process facts read off the masters, never the payload. */
function yarnLineProblem(p: IwoFabricBomParsed, facts: YarnModeFacts, yarnColours: string[]): string | null {
  if (!p.yarns) return null;
  const lines = p.yarns.map((y) => ({
    item_id: y.item_id,
    buy_stage_id: y.buy_stage_id,
    planned_kgs: y.planned_kgs,
    hasStages: y.stages.length > 0,
    colour_by: y.colour_by,
    shades: y.shades,
    steps: y.stages
      .filter((st) => st.process_id)
      .map((st) => ({ combo: st.combo ?? null, dyeing: facts.dyeingProcesses.has(st.process_id as string) })),
  }));
  return iwoYarnLineProblems(lines, { isDyedStage: (id) => facts.dyedStages.has(id), yarnColours })[0]?.message ?? null;
}

/**
 * THE FABRIC PROCESS STAGE RULES (0570), run on the server exactly as the
 * order action runs them: the same `stageRouteProblems`, the same master, and
 * `printDeclared: true` as the order server passes (the screen gates Print on
 * the Roll form prints panel; the server does not second-guess it). A yarn-dyed
 * cloth's dyeing belongs on Yarn Process — that gate comes from `items`.
 */
async function routeProblem(s: Db, bomId: string | null, p: IwoFabricBomParsed): Promise<string | null> {
  const rows = (p.processes ?? []).filter((r) => r.stage_id || r.process_id);
  if (rows.length === 0) return null;
  const [options, lookups] = await Promise.all([getFabricProcessRows(), getFabricProcessLookupRows()]);
  if (!lookups.stages.length) return "Could not read the fabric stages — try again.";

  /* A GREIGE FABRIC'S ROUTE STOPS AT GREIGE (Phase 2, `lines.ts`). The line
     stages are the payload's when it carries lines, else the stored ones. */
  const stageById = new Map(lookups.stages.map((st) => [st.id, st]));
  const rankOf = (id: string) => {
    const st = stageById.get(id);
    return st ? stageRank(st) : null;
  };
  const lineFacts = p.lines ?? (await storedLineFacts(s, bomId));
  const greige = iwoGreigeRouteProblems(rows, iwoFabricStages(lineFacts), rankOf, {
    fabric: () => "This fabric",
    stage: (id) => stageById.get(id)?.name ?? "coloured",
  })[0];
  if (greige) return greige.message;
  const typeById = await fabricTypesOf(s, [...new Set(rows.map((r) => r.item_id))]);
  if (typeof typeById === "string") return typeById;
  const problems = stageRouteProblems(
    rows.map((r, i) => ({
      key: String(i),
      item_id: r.item_id,
      combo: null,
      component_id: null,
      stage_id: r.stage_id ?? null,
      process_id: r.process_id ?? null,
      loss_for_id: r.loss_for_id ?? null,
      loss_pct: r.loss_pct == null ? "" : String(r.loss_pct),
      type_id: r.type_id ?? null,
    })),
    options,
    lookups.stages,
    { gatesFor: (itemId) => ({ printDeclared: true, fabricIsYarnDyed: isYarnDyed(typeById.get(itemId) ?? null) }) },
  );
  return problems[0]?.message ?? null;
}

/** The stored lines as the rules read them — for a save that did not carry
 *  `lines` (the payload rule in types.ts). */
async function storedLineFacts(s: Db, bomId: string | null) {
  if (!bomId) return [];
  const { data } = await s
    .from("iwo_fabric_bom_lines")
    .select("structure_id, item_id, color_name, fabric_form, mixing_uom_id, no_of_colors, gsm, finish_dia, stage_id, req_kgs")
    .eq("bom_id", bomId);
  return (data ?? []) as {
    structure_id: string | null;
    item_id: string | null;
    color_name: string | null;
    fabric_form: string | null;
    mixing_uom_id: string | null;
    no_of_colors: number | null;
    gsm: number | null;
    finish_dia: string | null;
    stage_id: string | null;
    req_kgs: number | null;
  }[];
}

/** Each fabric's Solid / Melange / Yarn Dyed name, off `items` — or the
 *  sentence to refuse with when the read fails. */
async function fabricTypesOf(s: Db, ids: string[]): Promise<Map<string, string | null> | string> {
  const typeById = new Map<string, string | null>();
  if (!ids.length) return typeById;
  const { data, error } = await s
    .from("items")
    .select("id, fabric_type:config_lookups!fabric_type_id(name)")
    .in("id", ids);
  if (error) return `Could not read the fabrics' types: ${error.message}`;
  type Named = { name: string | null };
  for (const r of (data ?? []) as unknown as { id: string; fabric_type: Named | Named[] | null }[]) {
    const t = r.fabric_type;
    typeById.set(r.id, Array.isArray(t) ? (t[0]?.name ?? null) : (t?.name ?? null));
  }
  return typeById;
}

/**
 * The line rules, run AGAIN on the server (`lines.ts`), with each fabric's type
 * read off `items` — never off the payload, which decides whether Mixing Uom is
 * owed. A failed lookup refuses the save: an empty map would read every cloth
 * as "not yarn dyed" and quietly waive the rule.
 */
async function lineProblem(s: Db, p: IwoFabricBomParsed): Promise<string | null> {
  if (!p.lines) return null;
  const ids = [...new Set(keptIwoFabricLines(p.lines).map((l) => l.item_id))];
  const typeById = new Map<string, string | null>();
  if (ids.length) {
    const { data, error } = await s
      .from("items")
      .select("id, fabric_type:config_lookups!fabric_type_id(name)")
      .in("id", ids);
    if (error) return `Could not read the fabrics' types: ${error.message}`;
    type Named = { name: string | null };
    for (const r of (data ?? []) as unknown as { id: string; fabric_type: Named | Named[] | null }[]) {
      const t = r.fabric_type;
      typeById.set(r.id, Array.isArray(t) ? (t[0]?.name ?? null) : (t?.name ?? null));
    }
  }
  /* GREIGE / coloured (Phase 2) off the stage master — a failed read refuses,
     since an empty list would read every stage as unrecognised and waive the
     colour rules. */
  const { stages } = await getFabricProcessLookupRows();
  if (!stages.length) return "Could not read the fabric stages — try again.";
  const stageById = new Map(stages.map((st) => [st.id, st]));
  const first = iwoFabricLineProblems(
    p.lines,
    (id) => typeById.get(id) ?? null,
    (id) => {
      const st = stageById.get(id);
      return st ? stageRank(st) : null;
    },
  )[0];
  return first?.message ?? null;
}

/**
 * Create (`bomId` null) or update the Fabric BOM of one IWO.
 *
 * THE DATE CEILING IS THE ORDER SCREEN'S (client 2026-09-01, applied there
 * from Order Entry): no future date. `max` on the input is advisory; this is
 * the refusal. The unit is stamped from the IWO by 0581's trigger.
 */
export async function saveIwoFabricBom(
  bomId: string | null,
  payload: IwoFabricBomInput,
): Promise<Result> {
  if (!(await can("orders", bomId ? "edit" : "create"))) return { ok: false, error: "Forbidden" };
  const parsed = iwoFabricBomInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const p = parsed.data;
  if (p.bom_date > today()) return { ok: false, error: "The BOM date cannot be in the future." };

  const s = await createClient();
  const mode = await iwoForOf(s, p.iwo_id);
  if (!mode) return { ok: false, error: "A Fabric BOM is raised only for an Internal Work Order For Yarn or Fabric." };
  let facts: YarnModeFacts | null = null;
  if (mode === "yarn") {
    // A Yarn IWO bypasses the fabric sections (screenshot 2937): no fabric
    // line or fabric route is accepted, and the yarn lines are its whole plan.
    if ((p.lines ?? []).length || (p.processes ?? []).some((r) => r.process_id)) {
      return { ok: false, error: "This work order is For Yarn — it takes yarn lines, not fabric lines." };
    }
    const read = await yarnModeFactsOf(s, p);
    if (typeof read === "string") return { ok: false, error: read };
    facts = read;
    const yarnErr = yarnLineProblem(p, facts, await yarnColoursOf(s, bomId, p));
    if (yarnErr) return { ok: false, error: yarnErr };
  }
  const lineErr = await lineProblem(s, p);
  if (lineErr) return { ok: false, error: lineErr };
  const routeErr = await routeProblem(s, bomId, p);
  if (routeErr) return { ok: false, error: routeErr };
  const header = { iwo_id: p.iwo_id, bom_date: p.bom_date, is_draft: p.is_draft, remark: p.remark || null };

  let id: string;
  if (!bomId) {
    const { data, error } = await s
      .from("iwo_fabric_boms")
      // location_id is overwritten by the guard trigger from the IWO; it is
      // sent only because the column is NOT NULL and checked by RLS.
      .insert({ ...header, location_id: await iwoLocation(s, p.iwo_id) })
      .select("id")
      .single();
    if (error || !data) {
      return {
        ok: false,
        error:
          error?.code === "23505"
            ? "This work order already has a Fabric BOM — open it from the list."
            : (error?.message ?? "Failed to create the Fabric BOM"),
      };
    }
    id = data.id;
  } else {
    id = bomId;
    const { error } = await s.from("iwo_fabric_boms").update(header).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  const childErr = await writeChildren(s, id, p, mode, facts);
  if (childErr) return { ok: false, error: childErr };

  await writeAudit({
    action: bomId ? "iwo_fabric_bom.updated" : "iwo_fabric_bom.created",
    entityType: "iwo_fabric_bom",
    entityId: id,
  });
  revalidatePath(PATH);
  return { ok: true, bomId: id };
}

async function iwoLocation(s: Db, iwoId: string): Promise<string | null> {
  const { data } = await s.from("internal_work_orders").select("location_id").eq("id", iwoId).single();
  return (data as { location_id: string | null } | null)?.location_id ?? null;
}

export async function deleteIwoFabricBom(bomId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await can("orders", "delete"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  // Every child table cascades from the header.
  const { error } = await s.from("iwo_fabric_boms").delete().eq("id", bomId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_fabric_bom.deleted", entityType: "iwo_fabric_bom", entityId: bomId });
  revalidatePath(PATH);
  return { ok: true };
}
