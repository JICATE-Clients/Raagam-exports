"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { cadMarkerInput, type CadMarkerInput } from "./types";
import { getCadWeightRows, getOrderPanels, type OrderPanelRow } from "./service";
import {
  componentWeightsForOrder,
  isRefusal,
  seedConsumptionFor,
  type ComponentWeight,
  type SeedTargetLine,
} from "./weights";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/**
 * The routes a saved CAD sheet changes.
 *
 * The Fabric BOM is here because a seed writes its lines, and the BOM's state is
 * a COLUMN on screens that are not this one — leaving them stale means the
 * operator watches a badge that no longer describes the document they just
 * changed. Same reasoning `rev()` in the Fabric BOM's own actions records.
 */
function rev(): void {
  revalidatePath("/orders/cad");
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/orders/setup");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Writing the sheet
// ---------------------------------------------------------------------------

/**
 * Drop the rows that are only scaffolding, and renumber.
 *
 * A LAYOUT IS EMPTY WHEN IT NAMES NO STYLE, NO DIA, NO FILE AND NO WEIGHT. Not
 * "every field is blank" and not "has a style": a seeded layout arrives with the
 * style already filled in from the order, so a has-a-style test would keep every
 * marker the operator chose not to use, and each would then sit in the sheet
 * claiming a style is laid out when nothing has been measured.
 */
function normalizeLayouts(data: CadMarkerInput) {
  return data.layouts
    .map((l) => ({
      style_ref_no: clean(l.style_ref_no),
      dia: l.dia ?? null,
      file_name: clean(l.file_name),
      storage_path: clean(l.storage_path),
      mime_type: clean(l.mime_type),
      size_bytes: l.size_bytes ?? null,
      notes: clean(l.notes),
      weights: l.weights
        .map((w) => ({
          coordinate_id: w.coordinate_id ?? null,
          component_id: w.component_id ?? null,
          fabric_category_id: w.fabric_category_id ?? null,
          grams: w.grams ?? null,
          notes: clean(w.notes),
        }))
        // A WEIGHT ROW IS KEPT WHEN IT NAMES A PANEL, weight or no weight.
        // "SLEEVE, not measured yet" is the state a sheet spends most of its
        // life in and it is the state the queue counts — dropping it would make
        // an unfinished sheet indistinguishable from a finished one.
        .filter((w) => w.component_id !== null)
        .map((w, i) => ({ ...w, sno: i + 1 })),
    }))
    .filter(
      (l) =>
        l.style_ref_no !== null ||
        l.dia !== null ||
        l.storage_path !== null ||
        l.weights.length > 0,
    )
    .map((l, i) => ({ ...l, sno: i + 1 }));
}

/**
 * Delete-all-then-reinsert, the idiom every child grid in Orders uses.
 *
 * THE OBJECT OUTLIVES THE ROW, deliberately — the same accepted remainder
 * `file-attachments.tsx` records. A marker PDF uploads the moment it is chosen
 * and its row is written on Save, so a delete that reached into the bucket would
 * make Cancel — the operator's undo — destroy a file they may have no other copy
 * of. Orphaned objects accumulate instead; a sweep is a separate job.
 */
async function writeLayouts(
  s: Awaited<ReturnType<typeof createClient>>,
  markerId: string,
  data: CadMarkerInput,
): Promise<Result> {
  // The weights cascade from the layouts, so deleting the parents is enough and
  // the order of two deletes does not become a thing to remember.
  const { error: delErr } = await s
    .from("order_cad_marker_layouts")
    .delete()
    .eq("marker_id", markerId);
  if (delErr) return fail(delErr.message);

  const layouts = normalizeLayouts(data);
  if (!layouts.length) return { ok: true };

  const { data: inserted, error } = await s
    .from("order_cad_marker_layouts")
    .insert(layouts.map(({ weights: _weights, ...l }) => ({ ...l, marker_id: markerId })))
    .select("id, sno");
  if (error) return fail(error.message);

  // Match ids back by `sno`, which `normalizeLayouts` has just made unique and
  // dense. `.select()` does not promise insertion order.
  const bySno = new Map(((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));

  const weightRows = layouts.flatMap((l) => {
    const layoutId = bySno.get(l.sno);
    if (!layoutId) return [];
    return l.weights.map((w) => ({ ...w, layout_id: layoutId }));
  });

  if (weightRows.length) {
    const { error: wErr } = await s.from("order_cad_component_weights").insert(weightRows);
    if (wErr) {
      // `uq_occw_panel` (0460) is the ordinary operator error — the same panel
      // added twice on one marker — not a bug. Say what happened in their words:
      // a raw unique-violation names an index nobody outside the migration has
      // heard of.
      return fail(
        wErr.code === "23505"
          ? "The same panel is weighed twice on one marker — remove the duplicate row"
          : wErr.message,
      );
    }
  }
  return { ok: true };
}

/** The header, with the submit stamp applied only on the transition INTO
 *  submitted — re-saving a submitted sheet must not keep moving the timestamp,
 *  which is what "when was this handed to Merchandising?" is read off. */
async function headerOnly(data: CadMarkerInput, wasSubmitted: boolean) {
  const submitting = data.is_submitted && !wasSubmitted;
  const s = await createClient();
  const { data: me } = submitting ? await s.auth.getUser() : { data: null };

  return {
    garment_order_id: data.garment_order_id,
    marker_date: data.marker_date,
    status: data.is_submitted ? "submitted" : "draft",
    ...(submitting
      ? { submitted_at: new Date().toISOString(), submitted_by: me?.user?.id ?? null }
      : {}),
    // Un-submitting CLEARS the stamp. A draft carrying "submitted at 14:02" is a
    // record that contradicts itself, and the contradiction is invisible until
    // somebody audits when the weights were handed over.
    ...(!data.is_submitted ? { submitted_at: null, submitted_by: null } : {}),
    remark: clean(data.remark),
  };
}

export async function createCadMarker(data: CadMarkerInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = cadMarkerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const { data: created, error } = await s
    .from("order_cad_markers")
    .insert(await headerOnly(p.data, false))
    .select("id")
    .single();

  if (error || !created) {
    // ONE SHEET PER ORDER IS A CONSTRAINT (`uq_order_cad_marker_order`, 0460),
    // so this is the ordinary second click and the ordinary race.
    return fail(
      error?.code === "23505"
        ? "This order already has a CAD marker sheet — open it from the queue instead"
        : (error?.message ?? "Failed to create the CAD marker sheet"),
    );
  }

  const childRes = await writeLayouts(s, created.id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_cad_marker.created",
    entityType: "order_cad_marker",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateCadMarker(id: string, data: CadMarkerInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = cadMarkerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const { data: before } = await s
    .from("order_cad_markers")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const { error } = await s
    .from("order_cad_markers")
    .update(await headerOnly(p.data, (before as { status?: string } | null)?.status === "submitted"))
    .eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeLayouts(s, id, p.data);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_cad_marker.updated",
    entityType: "order_cad_marker",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteCadMarker(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_cad_markers").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// What the editor asks the server for while it is open
// ---------------------------------------------------------------------------

export type OrderPanelsResult =
  | { ok: true; panels: OrderPanelRow[] }
  | { ok: false; error: string };

/**
 * The order's own coordinate/component panels, for the "Seed from order" button.
 *
 * A REFUSAL, NOT AN EMPTY LIST. An order whose Combos tab has no components
 * yields nothing to weigh, and an empty grid reads as "seeded, there was
 * nothing" — indistinguishable from a successful seed of a garment with no
 * panels, which is not a thing that exists.
 */
export async function loadOrderPanels(garmentOrderId: string): Promise<OrderPanelsResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const panels = await getOrderPanels(garmentOrderId);
  if (panels.length === 0) {
    return {
      ok: false,
      error:
        "This order declares no components yet — fill in Combos ▸ Structure Details first, " +
        "then seed the markers from it",
    };
  }
  return { ok: true, panels };
}

// ---------------------------------------------------------------------------
// The handoff to step 3 — Fabric BOM
// ---------------------------------------------------------------------------

/** One Fabric BOM line the seed either filled in or refused, with the sentence. */
export type SeedLineOutcome = {
  sno: number;
  /** null when the line was seeded. */
  refused: string | null;
  consumption?: number;
  uom_code?: string;
  component_name?: string;
};

export type CadSeedResult =
  | { ok: true; seeded: number; outcomes: SeedLineOutcome[]; wrote: boolean }
  | { ok: false; error: string };

/**
 * A KILOGRAM UNIT, RESOLVED FROM THE MASTER AND NEVER ASSUMED.
 *
 * A marker weight is in grams and there is no gram UOM in this database (the
 * live `uoms` master holds CONE, DZN, GROSS, KGS, LTR, MTR, NOS, PCS and an
 * INACTIVE `kg`), so kilograms is the only unit a seeded consumption can be in.
 * A Fabric BOM line that has not chosen a unit yet is given this one; a line
 * that has chosen a different one is REFUSED by name rather than overwritten —
 * re-unitting somebody's line under them is how a metre becomes a kilo.
 */
async function kilogramUom(
  s: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string; code: string } | null> {
  const { data } = await s.from("uoms").select("id, code, is_active");
  const rows = (data ?? []) as { id: string; code: string; is_active: boolean }[];
  const match = rows.find(
    (r) => r.is_active && ["KG", "KGS", "KILOGRAM", "KILOGRAMS"].includes(r.code.trim().toUpperCase()),
  );
  return match ? { id: match.id, code: match.code.trim().toUpperCase() } : null;
}

type PlannedSeed = {
  weights: ComponentWeight[];
  outcomes: SeedLineOutcome[];
  /** The line updates, ready to write. */
  updates: { id: string; consumption: number; dia: number | null; uom_id: string | null }[];
  bomId: string;
};

/**
 * Work out what the seed WOULD write, without writing it.
 *
 * The preview and the write share this so the operator cannot be shown one set
 * of figures and have another set saved — the same "one derivation, two readers"
 * call `fabricRequirementRows` makes for the requirement itself.
 */
async function planSeed(garmentOrderId: string): Promise<PlannedSeed | { error: string }> {
  const s = await createClient();

  const sheet = await getCadWeightRows(garmentOrderId);
  if (!sheet) return { error: "This order has no CAD marker sheet yet" };

  // §2's handoff happens ON SUBMIT. Seeding off a draft would publish figures
  // the CAD room is still editing into the document purchasing is checked
  // against, and nothing downstream would say they were provisional.
  if (sheet.status !== "submitted") {
    return { error: "Submit the CAD marker sheet before seeding the Fabric BOM" };
  }
  if (sheet.rows.length === 0) {
    return { error: "The CAD marker sheet has no panels on it yet" };
  }

  const weights = componentWeightsForOrder(sheet.rows);
  if (isRefusal(weights)) return { error: weights.refused };

  const { data: bom } = await s
    .from("order_fabric_boms")
    .select(
      "id, lines:order_fabric_bom_lines(id, sno, style_ref_no, component_id, " +
        "structure_id, consumption_uom_id)",
    )
    .eq("garment_order_id", garmentOrderId)
    .maybeSingle();

  if (!bom) {
    return {
      error: "This order has no fabric BOM yet — create it first, then seed the CAD weights into it",
    };
  }

  type BomRow = {
    id: string;
    lines:
      | {
          id: string;
          sno: number;
          style_ref_no: string | null;
          component_id: string | null;
          /** A `categories` row (0409 · 0426) — the same vocabulary a CAD
           *  weight's `fabric_category_id` holds, which is what lets the two be
           *  compared at all. */
          structure_id: string | null;
          consumption_uom_id: string | null;
        }[]
      | null;
  };
  const lines = ((bom as unknown as BomRow).lines ?? []).slice().sort((a, b) => a.sno - b.sno);
  if (lines.length === 0) {
    return { error: "The fabric BOM has no lines yet — add the fabrics, then seed" };
  }

  const kg = await kilogramUom(s);
  const { data: uomRows } = await s.from("uoms").select("id, code");
  const uomCodeById = new Map(
    ((uomRows ?? []) as { id: string; code: string }[]).map((u) => [u.id, u.code.trim().toUpperCase()]),
  );

  const outcomes: SeedLineOutcome[] = [];
  const updates: PlannedSeed["updates"] = [];

  for (const line of lines) {
    // A line with no unit yet takes kilograms; one that has chosen a unit keeps
    // it, and `seedConsumptionFor` refuses by name if that unit is not a mass.
    const uomCode = line.consumption_uom_id
      ? (uomCodeById.get(line.consumption_uom_id) ?? null)
      : (kg?.code ?? null);

    if (!line.consumption_uom_id && !kg) {
      outcomes.push({
        sno: line.sno,
        refused:
          `Line ${line.sno}: no active kilogram unit in the UOM master, so a gram weight has ` +
          `nowhere to land — add KGS`,
      });
      continue;
    }

    const target: SeedTargetLine = {
      sno: line.sno,
      style_ref_no: line.style_ref_no,
      component_id: line.component_id,
      structure_id: line.structure_id,
      uom_code: uomCode,
    };
    const seeded = seedConsumptionFor(target, weights);
    if (isRefusal(seeded)) {
      outcomes.push({ sno: line.sno, refused: seeded.refused });
      continue;
    }

    outcomes.push({
      sno: line.sno,
      refused: null,
      consumption: seeded.consumption,
      uom_code: uomCode ?? undefined,
      component_name: seeded.from.component_name,
    });
    updates.push({
      id: line.id,
      consumption: seeded.consumption,
      dia: seeded.dia,
      uom_id: line.consumption_uom_id ? null : (kg?.id ?? null),
    });
  }

  return { weights, outcomes, updates, bomId: (bom as unknown as BomRow).id };
}

/** What the seed would do, for the button's confirm line. Writes nothing. */
export async function previewCadSeed(garmentOrderId: string): Promise<CadSeedResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const plan = await planSeed(garmentOrderId);
  if ("error" in plan) return { ok: false, error: plan.error };
  return { ok: true, seeded: plan.updates.length, outcomes: plan.outcomes, wrote: false };
}

/**
 * §2's "Automated Workspace Sync" — push the CAD weights into the Fabric BOM.
 *
 * ## PARTIAL IS THE POINT, AND IT IS REPORTED
 *
 * A line the sheet cannot answer for is left exactly as the merchandiser typed
 * it and its reason is returned. The alternative — refusing the whole seed
 * because one of nine lines names a component CAD did not weigh — makes the
 * feature useless on precisely the orders it exists for. What is NOT acceptable
 * is a silent partial, so every skipped line comes back with the sentence saying
 * why and the screen prints them.
 *
 * ## THE STORED REQUIREMENT IS INVALIDATED, NOT RECOMPUTED
 *
 * `order_fabric_bom_requirements` was computed from consumptions that no longer
 * exist, so leaving `computed_basis_hash` alone would report a stale plan as
 * fresh — `bomFreshness` compares that hash and nothing else. Recomputing it
 * here would mean a second implementation of the fabric engine living outside
 * `lib/orders/fabric-bom/**`, which is exactly the duplication that makes two
 * screens disagree about one order. So the triple is CLEARED: "this document
 * has not been computed since" is the strongest true statement available, and
 * `bomStatusOf` renders it in the act-on-it tone. Open the Fabric BOM and save
 * it to recompute.
 */
export async function seedFabricBomFromCad(garmentOrderId: string): Promise<CadSeedResult> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };

  const plan = await planSeed(garmentOrderId);
  if ("error" in plan) return { ok: false, error: plan.error };

  if (plan.updates.length === 0) {
    // EVERY line refused. That is not a successful seed of nothing — returning
    // ok here would flash a green toast over a document nothing was written to.
    return {
      ok: false,
      error:
        plan.outcomes[0]?.refused ??
        "No fabric BOM line could take a marker weight — check the components on both documents",
    };
  }

  const s = await createClient();
  for (const u of plan.updates) {
    const patch: Record<string, unknown> = { consumption: u.consumption };
    // The dia carries across only when the marker weights agree on one — see
    // `ComponentWeight.dia`. Never null it: the merchandiser may have typed a
    // dia the CAD sheet has no opinion about.
    if (u.dia != null) patch.dia = u.dia;
    if (u.uom_id) patch.consumption_uom_id = u.uom_id;

    const { error } = await s.from("order_fabric_bom_lines").update(patch).eq("id", u.id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: hdrErr } = await s
    .from("order_fabric_boms")
    .update({ computed_at: null, computed_for_qty: null, computed_basis_hash: null })
    .eq("id", plan.bomId);
  if (hdrErr) return { ok: false, error: hdrErr.message };

  await writeAudit({
    action: "order_fabric_bom.seeded_from_cad",
    entityType: "order_fabric_bom",
    entityId: plan.bomId,
  });
  rev();

  return { ok: true, seeded: plan.updates.length, outcomes: plan.outcomes, wrote: true };
}
