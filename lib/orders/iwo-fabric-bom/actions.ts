"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import { iwoFabricBomInput, type IwoFabricBomInput, type IwoFabricBomParsed } from "./types";
import { iwoFabricLineProblems, keptIwoFabricLines } from "./lines";
import { iwoFabricGross, iwoRoutesByFabric } from "./yarn";
import { kgUomOf } from "./service";
// The ORDER Fabric BOM's pure engine and its order-agnostic loaders, reused as
// they are — see yarn.ts for why the IWO must not compute a yarn weight any
// other way. Nothing here edits the order module.
import {
  isRefusal,
  stageProblem,
  stageProcessQty,
  yarnPurchase,
  yarnStageStarted,
  type FabricComposition,
} from "@/lib/orders/fabric-bom/yarn-process";
import { stageRouteProblems } from "@/lib/orders/fabric-bom/stage-routes";
import { isYarnDyed } from "@/lib/orders/fabric-bom/fabric-line-rules";
import {
  getBomYarnComposition,
  getFabricProcessLookupRows,
  getFabricProcessRows,
} from "@/lib/orders/fabric-bom/service";

type Result = { ok: true; bomId: string } | { ok: false; error: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const PATH = "/orders/iwo-fabric-bom";

/**
 * Rewrite each child list the payload CARRIES; leave any it omits alone (see
 * types.ts). Delete-then-insert, the order screen's own write shape — the
 * child tables hold nothing a row id is cited by.
 */
async function writeChildren(s: Db, bomId: string, p: IwoFabricBomParsed) {
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
        return error.code === "23514" ? "A fabric line names an item that is not a fabric." : error.message;
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
    const err = await writeYarns(s, bomId, p);
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
async function writeYarns(s: Db, bomId: string, p: IwoFabricBomParsed): Promise<string | null> {
  if (!p.yarns) return null;
  if (!p.lines || !p.processes) {
    return "The yarn weights need the fabric lines and their routes in the same save — reopen the BOM and save again.";
  }
  const lines = keptIwoFabricLines(p.lines);
  const fabricIds = [...new Set(lines.map((l) => l.item_id))];

  const [{ compositions }, kg] = await Promise.all([getBomYarnComposition(fabricIds), kgUomOf(s)]);
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
  const out: { row: Record<string, unknown>; stages: Record<string, unknown>[] }[] = [];
  for (const y of sent) {
    if (seen.has(y.item_id)) continue;
    seen.add(y.item_id);
    const kept = y.stages.filter((st) =>
      yarnStageStarted({
        stage_id: st.stage_id,
        process_id: st.process_id,
        loss_for_id: st.loss_for_id ?? null,
        combo: st.combo ?? "",
        description: st.description ?? "",
        loss_pct: st.loss_pct == null ? "" : String(st.loss_pct),
      }),
    );
    const weight = yarnPurchase(
      y.item_id,
      gross,
      compById,
      routes,
      kept.map((st) => ({ combo: st.combo ?? null, loss_pct: st.loss_pct ?? null })),
      kg?.decimals ?? null,
      // Every IWO fabric is knitted from yarn (the order screen's Source
      // control is hidden, so its default is the only answer), and no yarn-dyed
      // shade losses are recorded yet — the same two arguments the preview passes.
      new Map(),
      [],
    );
    const refused = isRefusal(weight);
    const byCombo = refused ? [] : weight.byCombo;
    out.push({
      row: {
        bom_id: bomId,
        sno: out.length + 1,
        item_id: y.item_id,
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
    });
  }

  // Stages go with their yarns by cascade (they carry `yarn_id`, not `bom_id`).
  const { error: clearErr } = await s.from("iwo_fabric_bom_yarns").delete().eq("bom_id", bomId);
  if (clearErr) return clearErr.message;
  if (out.length === 0) return null;

  const { data: inserted, error } = await s
    .from("iwo_fabric_bom_yarns")
    .insert(out.map((y) => y.row))
    .select("id, sno");
  if (error) return error.code === "23514" ? "A yarn row names an item that is not a yarn." : error.message;
  const bySno = new Map(((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
  const stageRows = out.flatMap((y) =>
    y.stages.map((st) => ({ ...st, yarn_id: bySno.get(y.row.sno as number) })),
  );
  if (stageRows.some((r) => !r.yarn_id)) return "Could not read back the saved yarns.";
  if (stageRows.length) {
    const { error: stErr } = await s.from("iwo_fabric_bom_yarn_stages").insert(stageRows);
    if (stErr) return stErr.message;
  }
  return null;
}

/**
 * THE FABRIC PROCESS STAGE RULES (0570), run on the server exactly as the
 * order action runs them: the same `stageRouteProblems`, the same master, and
 * `printDeclared: true` as the order server passes (the screen gates Print on
 * the Roll form prints panel; the server does not second-guess it). A yarn-dyed
 * cloth's dyeing belongs on Yarn Process — that gate comes from `items`.
 */
async function routeProblem(s: Db, p: IwoFabricBomParsed): Promise<string | null> {
  const rows = (p.processes ?? []).filter((r) => r.stage_id || r.process_id);
  if (rows.length === 0) return null;
  const [options, lookups] = await Promise.all([getFabricProcessRows(), getFabricProcessLookupRows()]);
  if (!lookups.stages.length) return null;
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
  const first = iwoFabricLineProblems(p.lines, (id) => typeById.get(id) ?? null)[0];
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
  const lineErr = await lineProblem(s, p);
  if (lineErr) return { ok: false, error: lineErr };
  const routeErr = await routeProblem(s, p);
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

  const childErr = await writeChildren(s, id, p);
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
