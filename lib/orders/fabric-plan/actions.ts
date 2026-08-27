"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { fabricPlanInput, type FabricPlanInput, type PlannableFabric } from "./types";
import { getPlannableFabrics } from "./service";
import { isRefusal, routeQuantities, type StageInput } from "./route";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

function rev(): void {
  revalidatePath("/orders/fabric-plan");
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/orders/setup");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

/**
 * Drop the lines that are only scaffolding.
 *
 * A LINE IS EMPTY WHEN IT NAMES NO FABRIC AND HAS NO ROUTE. Not "every field is
 * blank": a line seeded from the BOM arrives with its five address keys and its
 * requirement already filled, so an all-blank test would keep every fabric the
 * operator chose not to plan — and each would then sit in the document with an
 * empty route, indistinguishable from one they meant to come back to.
 */
function normalizeLines(data: FabricPlanInput) {
  return data.lines
    .filter((l) => l.item_id !== null || l.stages.some((st) => st.process_id))
    .map((l, i) => ({
      line: {
        sno: i + 1,
        style_ref_no: clean(l.style_ref_no),
        combo: clean(l.combo),
        structure_id: l.structure_id ?? null,
        component_id: l.component_id ?? null,
        item_id: l.item_id ?? null,
        required_qty: l.required_qty ?? null,
        required_uom_id: l.required_uom_id ?? null,
        notes: clean(l.notes),
      },
      stages: l.stages
        .filter((st) => st.process_id !== null)
        .map((st, j) => ({
          sno: j + 1,
          process_id: st.process_id ?? null,
          mode: st.mode,
          // A PROCESSOR IS DROPPED WHEN THE STAGE GOES IN-HOUSE. Requiredness
          // here is a property of the field FOR A STATE (AGENTS.md, Mandatory
          // fields) — and the inverse matters too: a vendor left behind on an
          // in-house stage is a name the screen no longer shows and a report
          // would still group by.
          vendor_id: st.mode === "outsourced" ? (st.vendor_id ?? null) : null,
          loss_pct: st.loss_pct ?? null,
          uom_id: st.uom_id ?? null,
          planned_start: clean(st.planned_start),
          planned_end: clean(st.planned_end),
          notes: clean(st.notes),
        })),
    }));
}

type NormalLine = ReturnType<typeof normalizeLines>[number];

/**
 * Solve one line's route and shape the stage rows for insertion.
 *
 * EVERY STAGE GETS A ROW, including when the route refuses. `chk_ofps_answer_or_reason`
 * (0427) is the database saying the same thing: a stage either carries
 * quantities or carries the sentence explaining their absence. A route that
 * simply stored fewer stages would leave a document whose steps do not match
 * what is on screen.
 */
function stageRows(
  line: NormalLine,
  lineId: string,
  decimals: number | null,
): Record<string, unknown>[] {
  const stages: StageInput[] = line.stages.map((st) => ({
    sno: st.sno,
    process_id: st.process_id,
    mode: st.mode,
    vendor_id: st.vendor_id,
    loss_pct: st.loss_pct,
  }));

  const solved = routeQuantities(stages, Number(line.line.required_qty) || 0, decimals);

  return line.stages.map((st, i) => {
    const base = { ...st, line_id: lineId };
    if (isRefusal(solved)) {
      return { ...base, input_qty: null, output_qty: null, refusal_reason: solved.refused };
    }
    const q = solved[i];
    return { ...base, input_qty: q.input, output_qty: q.output, refusal_reason: null };
  });
}

async function uomDecimals(
  s: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, number | null>> {
  const { data } = await s.from("uoms").select("id, decimal_places_allowed");
  return new Map(
    ((data ?? []) as { id: string; decimal_places_allowed: number | null }[]).map((r) => [
      r.id,
      r.decimal_places_allowed,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function headerOnly(data: FabricPlanInput) {
  return {
    garment_order_id: data.garment_order_id,
    plan_date: data.plan_date,
    is_draft: data.is_draft,
    remark: clean(data.remark),
    bom_id: data.bom_id ?? null,
    // Stamped from what the FORM was working against, not re-read here. If the
    // BOM has been saved by someone else since this editor opened, the plan must
    // record the figures it actually used — re-reading would stamp a timestamp
    // for a requirement this document never saw, and the queue would report the
    // route as current when it is not.
    bom_computed_at: clean(data.bom_computed_at),
  };
}

async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  planId: string,
  data: FabricPlanInput,
): Promise<Result> {
  // Stages first — they reference the lines, so deleting the other way round
  // leaves the cascade to do it and the order of two deletes becomes a thing to
  // remember rather than a thing to read.
  for (const t of ["order_fabric_plan_stages", "order_fabric_plan_lines"]) {
    const { error } = await s.from(t).delete().eq("plan_id", planId);
    if (error) return fail(error.message);
  }

  const lines = normalizeLines(data);
  if (lines.length === 0) return { ok: true };

  const { data: inserted, error } = await s
    .from("order_fabric_plan_lines")
    .insert(lines.map((l) => ({ ...l.line, plan_id: planId })))
    .select("id, sno");
  if (error) return fail(error.message);

  // Match ids back by `sno`, which `normalizeLines` has just made unique and
  // dense. `.select()` does not promise insertion order.
  const bySno = new Map(((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
  const decimals = await uomDecimals(s);

  const rows: Record<string, unknown>[] = [];
  for (const l of lines) {
    const id = bySno.get(l.line.sno);
    if (!id) return fail("Could not read back the saved plan lines");
    rows.push(
      ...stageRows(
        l,
        id,
        l.line.required_uom_id ? (decimals.get(l.line.required_uom_id) ?? null) : null,
      ).map((r) => ({ ...r, plan_id: planId })),
    );
  }

  if (rows.length) {
    const { error: stageErr } = await s.from("order_fabric_plan_stages").insert(rows);
    if (stageErr) return fail(stageErr.message);
  }
  return { ok: true };
}

export async function createFabricPlan(data: FabricPlanInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = fabricPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const { data: created, error } = await s
    .from("order_fabric_plans")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) {
    // ONE PLAN PER ORDER IS A CONSTRAINT (`uq_order_fabric_plan_order`, 0427),
    // so this is the ordinary second click, not a bug. A raw unique-violation
    // string names an index nobody outside that file has heard of.
    return fail(
      error?.code === "23505"
        ? "This order already has a fabric plan — open it from the queue instead"
        : (error?.message ?? "Failed to create the fabric plan"),
    );
  }

  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_plan.created",
    entityType: "order_fabric_plan",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateFabricPlan(id: string, data: FabricPlanInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = fabricPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const { error } = await s.from("order_fabric_plans").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_plan.updated",
    entityType: "order_fabric_plan",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteFabricPlan(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_fabric_plans").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// What the editor asks the server for while it is open
// ---------------------------------------------------------------------------

export type PlannableResult =
  | {
      ok: true;
      bomId: string | null;
      bomComputedAt: string | null;
      fabrics: PlannableFabric[];
    }
  | { ok: false; error: string };

/**
 * The order's Fabric BOM, as the list of fabrics a route can be hung under.
 *
 * ONE ROUND TRIP PER ORDER. The routes recalculate as the operator types, but
 * only the STAGES move — the BOM's requirement does not — so this fires when an
 * order is picked and not on a keystroke.
 *
 * EMPTY IS AN ANSWER WITH A REASON. "This order has no Fabric BOM" and "the BOM
 * has no lines" send the operator to different places, and both read as an empty
 * grid unless they are said out loud.
 */
export async function loadPlannableFabrics(garmentOrderId: string): Promise<PlannableResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const res = await getPlannableFabrics(garmentOrderId);
  if (!res.bomId) {
    return { ok: false, error: "This order has no Fabric BOM yet — plan its fabric first (step 3)" };
  }
  if (res.fabrics.length === 0) {
    return { ok: false, error: "This order's Fabric BOM has no fabric lines yet" };
  }
  return { ok: true, ...res };
}
