"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrDeactivate } from "@/lib/masters/delete-guard";
import { writeAudit } from "@/lib/audit";
import { garmentStyleInput, type GarmentStyleInput } from "./types";
import { componentRowStarted } from "./rules";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
/** A delete that may have soft-disabled instead — the screen needs both halves
 *  to say "marked inactive because it is used by X" rather than "deleted". */
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

// Typed `Failure`, not `Result`: an action returning `DeleteResult` still wants
// to `return fail(...)`, and the wide union's `{ ok: true }` branch is not
// assignable to `{ ok: true; inactive: boolean }`.
function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/styles");
  revalidatePath("/orders/all");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * The code the next style created on `styleDate` WOULD receive — so the New
 * Style form can show its serial while it is being entered, instead of "(auto)".
 *
 * ASKS THE DATABASE RATHER THAN COMPOSING THE STRING HERE. Building
 * `STL/<fy>/<n>` in TypeScript would be a second implementation of the format
 * AND of the April–March fiscal-year rule; the first time either changed, the
 * screen would confidently display a number different from the one saved.
 * `peek_garment_style_code` shares BOTH halves with the trigger that actually
 * assigns — `garment_style_fy()` for the year and
 * `public.garment_style_code_format()` for the shape — which is what makes them
 * impossible to drift apart.
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
 * Components. `trims` / `trims_category_id` are no longer produced (they left
 * the Zod input on 2026-08-10) and neither are `processes` (same date, same
 * reason: the legacy grid has no process column). The stored column values are
 * left alone in both cases.
 */
function normalizeComponents(data: GarmentStyleInput) {
  return data.components
    .map((c) => ({
      coordinate_id: c.coordinate_id ?? null,
      component_id: c.component_id ?? null,
      fabric_category_id: c.fabric_category_id ?? null,
      comp_type: clean(c.comp_type),
      item_id: c.item_id ?? null,
    }))
    // Same predicate the screen marks its mandatory cells with — see
    // `componentRowStarted`. Two copies of "is this row real?" would cage the
    // operator on a row this drops, or drop a row whose fields it required.
    //
    // WRAPPED RATHER THAN POINT-FREE, since the predicate gained an optional
    // second argument (the PCS implied coordinate, 2026-08-29): `.filter` hands
    // it the row INDEX, which does not type-check. The RESULT would have been
    // unchanged — an index is a number, a coordinate id is a string, so the
    // discount never matches — and `check-style-rules.mts` asserts that, so
    // nobody goes hunting for a data bug that is not there. The compiler is the
    // guard; this is just the shape that satisfies it.
    //
    // The Style master's grid has no auto-fill, so it passes nothing and reads
    // exactly as it always did. The argument exists for the Garment Order.
    .filter((c) => componentRowStarted(c))
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

/**
 * Sizes — blank rows dropped, repeats dropped, then renumbered.
 *
 * DE-DUPLICATED (client 2026-08-17, screenshot 2316: a Sizes tab reading
 * L, L, M, M). The screen's `usedIds` is what stops a second "L" being OFFERED,
 * and that is the half the operator sees; this is the half that holds for every
 * other way the array can arrive — a size group filled twice, a payload replayed,
 * or the day `garment_styles` becomes a `lib/data-io` entity, which writes
 * straight past the action. AGENTS.md's standing phrasing: the screen check is a
 * courtesy, this one is the guard.
 *
 * FIRST OCCURRENCE WINS, which is what makes the renumbering below mean
 * anything: the operator's order is the size order, and dropping the LATER
 * duplicate keeps the row they entered first where they put it.
 *
 * `sno` is assigned AFTER the filter, so the stored serials stay 1..n with no
 * gap where a duplicate was — the read side sorts on `sno` (`service.ts`).
 */
function normalizeSizes(data: GarmentStyleInput) {
  const seen = new Set<string>();
  return data.sizes
    .filter((s) => !!s.size_id)
    .filter((s) => {
      const id = s.size_id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
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
   * Components are a plain insert again.
   *
   * This used to `.select("id")` and pair the returned ids positionally with the
   * payload, because `garment_style_component_processes` had to reference
   * component rows that only exist after the insert — and are different ids on
   * every save. The process sub-grid was removed on 2026-08-10, so that pairing,
   * and the length-mismatch guard that protected it, have nothing left to
   * protect. Restoring the sub-grid means restoring both; see git history rather
   * than reinventing it.
   */
  const comps = normalizeComponents(data);
  if (comps.length) {
    const { error } = await s
      .from("garment_style_components")
      .insert(comps.map((c) => ({ ...c, style_id: styleId })));
    if (error) return fail(error.message);
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

  /*
   * APPROVED SAMPLE IS OPTIONAL AGAIN (client 2026-08-13). The create guard
   * that stood here is gone, with the form's `*` and its Save-gate entry.
   *
   * It refused a null `approved_sample_id` on create — and its own comment had
   * already noticed the hole it was standing in ("there are no approved samples
   * in the data yet"), which is why it exempted UPDATE. The exemption was aimed
   * at the wrong half: `samples` has ZERO rows, so it was CREATE that could
   * never be satisfied, and every new style was refused by a rule whose field
   * had nothing to offer. Style is required by the Garment Order's Style(s)
   * tab, so this stopped order entry outright.
   *
   * The old note argued a draft must not be exempt, because the client wants to
   * count how many marketing samples become bulk production. That reasoning
   * still holds and is why this is a WITHDRAWAL rather than a loosening: bring
   * the guard back — drafts included — the day a sample can be raised from the
   * picker. Until then it counts nothing and refuses everything.
   */

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

export async function deleteGarmentStyle(id: string): Promise<DeleteResult> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // `blocked`, not "is_active": that is the flag `garment_styles` carries, and a
  // patch naming the wrong column fails at the one moment the guard is needed.
  // The trailing note still holds and does not conflict — 0344 ignores CASCADE
  // by design, so a style's own detail rows cascade and never count as "in use";
  // an order quoting the style does, and deactivates it instead.
  const res = await deleteOrDeactivate(s, "garment_styles", id, "blocked"); // children cascade
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
