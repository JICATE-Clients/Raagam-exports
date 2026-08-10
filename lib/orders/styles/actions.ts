"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { garmentStyleInput, type GarmentStyleInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/styles");
  revalidatePath("/orders");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * The code the next style created on `styleDate` WOULD receive — so the New
 * Style form can show its serial while it is being entered, instead of "(auto)".
 *
 * ASKS THE DATABASE RATHER THAN COMPOSING THE STRING HERE. Building
 * `STL-<fy>-<n>` in TypeScript would be a second implementation of the format
 * AND of the April–March fiscal-year rule; the first time either changed, the
 * screen would confidently display a number different from the one saved.
 * `peek_garment_style_code` (0393) shares `garment_style_fy()` with the trigger
 * that actually assigns, which is what makes them impossible to drift apart.
 *
 * A PREDICTION, NOT A RESERVATION. The peek does not consume the counter — so
 * opening the form and abandoning it burns no numbers — which means two
 * operators entering at once both see the same one and only the first to save
 * gets it. The trigger stays the sole authority, so the STORED value is always
 * correct even when the preview was not.
 *
 * Returns null rather than throwing when the RPC is missing (0393 not applied)
 * or RLS denies the read. The field then falls back to "(auto)", which is the
 * honest answer: better a placeholder than a number nothing will honour.
 */
export async function previewStyleCode(styleDate: string | null): Promise<string | null> {
  if (!(await can("orders", "create"))) return null;
  const s = await createClient();
  const { data, error } = await s.rpc("peek_garment_style_code", {
    p_on: styleDate && styleDate.trim() ? styleDate : null,
  });
  if (error) return null;
  return typeof data === "string" && data ? data : null;
}

// ---------- child normalizers (drop fully-empty rows + renumber sno) ----------

function normalizeCoordinates(data: GarmentStyleInput) {
  return data.coordinates
    .map((c) => ({ coordinate_id: c.coordinate_id ?? null }))
    // A coordinate IS its name now, so an unanswered row is an empty row.
    // This used to keep a row that had only an M.List No; that field is gone.
    .filter((c) => c.coordinate_id)
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

/**
 * Components, each carrying its own process list.
 *
 * The processes are kept ATTACHED here rather than flattened, because they can
 * only be written once the component row exists and has an id — see
 * `writeChildren`. `trims` / `trims_category_id` are no longer produced: they
 * left the Zod input on 2026-08-10, so there is nothing to read, and the stored
 * column values are left alone.
 */
function normalizeComponents(data: GarmentStyleInput) {
  return data.components
    .map((c) => ({
      row: {
        coordinate_id: c.coordinate_id ?? null,
        component_id: c.component_id ?? null,
        structure_id: c.structure_id ?? null,
        comp_type: clean(c.comp_type),
        item_id: c.item_id ?? null,
      },
      processes: (c.processes ?? [])
        .filter((p) => !!p.process_id)
        .map((p, i) => ({ process_id: p.process_id as string, sno: i + 1 })),
    }))
    .filter(
      (c) =>
        c.row.coordinate_id ||
        c.row.component_id ||
        c.row.structure_id ||
        c.row.comp_type ||
        c.row.item_id ||
        c.processes.length > 0,
    )
    .map((c, i) => ({ ...c, row: { ...c.row, sno: i + 1 } }));
}

function normalizeSizes(data: GarmentStyleInput) {
  return data.sizes
    .filter((s) => !!s.size_id)
    .map((s, i) => ({ size_id: s.size_id as string, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given style id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  styleId: string,
  data: GarmentStyleInput,
): Promise<Result> {
  const tables = [
    "garment_style_coordinates",
    "garment_style_components",
    "garment_style_sizes",
  ];
  for (const t of tables) {
    const { error } = await s.from(t).delete().eq("style_id", styleId);
    if (error) return fail(error.message);
  }

  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_style_coordinates", normalizeCoordinates(data)],
    ["garment_style_sizes", normalizeSizes(data)],
  ];
  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s
      .from(table)
      .insert(rows.map((r) => ({ ...r, style_id: styleId })));
    if (error) return fail(error.message);
  }

  /**
   * COMPONENTS AND THEIR PROCESSES — the one child that cannot be a blind insert.
   *
   * `garment_style_component_processes.component_id` points at a component row,
   * and this function deletes and recreates every component on every save. So
   * the ids the processes must reference DO NOT EXIST until the components are
   * inserted, and they are different ids each time.
   *
   * Hence `.select("id")`: PostgREST returns the inserted rows in the order
   * they were sent, so index i of the response is index i of the payload. Write
   * the processes with a stale or guessed id and every one of them silently
   * disappears on the second save — the failure would only ever show up as
   * "the processes I entered are gone", one save later, with nothing logged.
   */
  const comps = normalizeComponents(data);
  if (comps.length) {
    const { data: created, error } = await s
      .from("garment_style_components")
      .insert(comps.map((c) => ({ ...c.row, style_id: styleId })))
      .select("id");
    if (error) return fail(error.message);

    const rows = created ?? [];
    if (rows.length !== comps.length) {
      // Never observed, but the id↔payload pairing below is positional, so a
      // length mismatch means the pairing is wrong and the processes would be
      // attached to the wrong components. Refuse rather than mis-attach.
      return fail("Component rows did not round-trip; processes were not saved.");
    }

    const procRows = comps.flatMap((c, i) =>
      c.processes.map((p) => ({ ...p, component_id: (rows[i] as { id: string }).id })),
    );
    if (procRows.length) {
      const { error: pErr } = await s
        .from("garment_style_component_processes")
        .insert(procRows);
      if (pErr) return fail(pErr.message);
    }
  }

  return { ok: true };
}

/** Strip child arrays so only header columns hit garment_styles. */
function headerOnly(data: GarmentStyleInput) {
  const { coordinates: _c, components: _m, sizes: _s, ...header } = data;
  void _c;
  void _m;
  void _s;
  return header;
}

export async function createGarmentStyle(data: GarmentStyleInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = garmentStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("garment_styles")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create style");
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_style.created",
    entityType: "garment_style",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateGarmentStyle(
  id: string,
  data: GarmentStyleInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = garmentStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("garment_styles").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_style.updated",
    entityType: "garment_style",
    entityId: id,
  });
  rev();
  return { ok: true };
}

export async function deleteGarmentStyle(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("garment_styles").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
