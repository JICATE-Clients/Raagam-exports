"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  materialAttributeInput,
  type MaterialAttributeInput,
} from "./material-attribute-types";
import { deleteOrBlock } from "./delete-guard";
import { materialAttributeUsage, materialsUsedByLabel } from "./material-attribute-service";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/material-attributes");
}
function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Drop blank lines (no attribute selected) and renumber sno 1..n. Options are
 *  kept alongside each line so they can be inserted once the line id exists. */
function normalizeLines(data: MaterialAttributeInput) {
  return data.lines
    .filter((l) => l.attribute_id)
    .map((l, i) => ({
      row: {
        sno: i + 1,
        attribute_id: l.attribute_id,
        value_in_steps: l.value_in_steps,
        start_value: l.start_value,
        end_value: l.end_value,
        unit_id: l.unit_id,
        // Free-text suffix on the generated values (0350). `unit_id` still
        // travels beside it so a line configured before 0350 round-trips.
        unit_label: l.unit_label?.trim() || null,
        step_value: l.step_value,
        mandatory: l.mandatory,
        inactive: l.inactive,
      },
      // The value list is the single source of a line's options — persisted for
      // BOTH stepped (auto-generated on the client) and manual lines.
      options: l.options
        .filter((o) => o.description.trim())
        .map((o, j) => ({ sno: j + 1, description: o.description.trim(), blocked: o.blocked })),
    }));
}

/**
 * The same attribute added twice to one set, or the same value typed twice
 * inside one attribute — both were silently accepted (client 2026-07-28). The
 * screen now blocks them live (red row + disabled Save), so this only fires on
 * form state posted from a tab that was open before that guard. It has to fire
 * HERE and not at 0350's unique indexes (`uq_material_attribute_lines_attr`,
 * `uq_mal_options_desc`): a raw 23505 reaches the user as constraint gibberish.
 * Comparison matches the indexes — trimmed and case-insensitive.
 */
function duplicateError(lines: ReturnType<typeof normalizeLines>): string | null {
  const seenAttr = new Set<string>();
  for (const l of lines) {
    const attr = l.row.attribute_id;
    if (attr) {
      if (seenAttr.has(attr)) {
        return "The same attribute is listed twice — each attribute may appear only once in a set. Remove the duplicate line and save again.";
      }
      seenAttr.add(attr);
    }
    const seenDesc = new Set<string>();
    for (const o of l.options) {
      // normalizeLines already trimmed and dropped blanks.
      const key = o.description.toUpperCase();
      if (seenDesc.has(key)) {
        return `The value "${o.description}" is listed twice under one attribute — each value may appear only once. Remove the duplicate and save again.`;
      }
      seenDesc.add(key);
    }
  }
  return null;
}

/** Postgres reports a violated unique index by its name; translate the two from
 *  0350 rather than letting "duplicate key value violates unique constraint …"
 *  land in a toast. Anything else passes through unchanged. */
function lineErrorMessage(err: { code?: string; message: string }): string {
  if (err.code !== "23505") return err.message;
  if (err.message.includes("uq_material_attribute_lines_attr")) {
    return "The same attribute is listed twice — each attribute may appear only once in a set.";
  }
  if (err.message.includes("uq_mal_options_desc")) {
    return "The same value is listed twice under one attribute — each value may appear only once.";
  }
  return err.message;
}

/** Insert the (already normalized) lines for one material_attribute, then insert
 *  each line's pre-defined value options against the freshly-created line ids. */
async function insertLines(
  s: SupabaseClient,
  materialAttributeId: string,
  lines: ReturnType<typeof normalizeLines>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true };
  const { data: created, error } = await s
    .from("material_attribute_lines")
    .insert(lines.map((l) => ({ ...l.row, material_attribute_id: materialAttributeId })))
    .select("id, sno");
  if (error) return fail(lineErrorMessage(error));
  // Map new line ids back by sno (insert preserves order, but match on sno to be safe).
  const idBySno = new Map((created ?? []).map((r) => [r.sno as number, r.id as string]));
  const optionRows = lines.flatMap((l) => {
    const lineId = idBySno.get(l.row.sno);
    return lineId ? l.options.map((o) => ({ ...o, material_attribute_line_id: lineId })) : [];
  });
  if (optionRows.length) {
    const { error: oErr } = await s.from("material_attribute_line_options").insert(optionRows);
    if (oErr) return fail(lineErrorMessage(oErr));
  }
  return { ok: true };
}

export async function createMaterialAttribute(data: MaterialAttributeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = materialAttributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const lines = normalizeLines(p.data);
  const dupLine = duplicateError(lines);
  if (dupLine) return fail(dupLine);
  // One config per (Item Class + Category) — if one already exists the user must
  // edit it, not create a duplicate (client 2026-07-25).
  if (header.item_class_id && header.category_id) {
    const { data: dup } = await s
      .from("material_attributes")
      .select("id")
      .eq("item_class_id", header.item_class_id)
      .eq("category_id", header.category_id)
      .maybeSingle();
    if (dup) {
      return fail("A Material Attribute set already exists for this Item Class and Category — edit the existing one instead.");
    }
  }
  const { data: created, error } = await s
    .from("material_attributes")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const ins = await insertLines(s, created.id, lines);
  if (!ins.ok) return ins;
  rev();
  return { ok: true };
}

export async function updateMaterialAttribute(
  id: string,
  data: MaterialAttributeInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = materialAttributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const lines = normalizeLines(p.data);
  const dupLine = duplicateError(lines);
  if (dupLine) return fail(dupLine);
  const { error } = await s.from("material_attributes").update(header).eq("id", id);
  if (error) return fail(error.message);

  /*
   * RECONCILED BY ATTRIBUTE, NOT REPLACED WHOLESALE.
   *
   * This was `delete().eq("material_attribute_id", id)` followed by
   * `insertLines`, which gave every line a FRESH id on every save — and
   * `item_attribute_values.attribute_line_id` is `ON DELETE SET NULL`, so an
   * ordinary save stripped every Material's stored answers of WHICH ATTRIBUTE
   * they answer. The value text survived; the meaning did not. **10 of 17
   * answers in the live DB are already orphaned that way** (2026-08-11), and
   * they stay orphaned: the text alone cannot say which question it answered,
   * and `audit_log` holds no entry for any attribute table.
   *
   * This is the same defect as the one fixed the same day in
   * `saveAttributeValues` (`extras-actions.ts`), one level down. Both were
   * "replace the child grid wholesale", and both had an inbound FK the comment
   * beside the delete never mentioned.
   *
   * THE IDENTITY IS `attribute_id` WITHIN THE SET, and the schema already agrees:
   * `uq_material_attribute_lines_attr` is UNIQUE (material_attribute_id,
   * attribute_id) WHERE attribute_id IS NOT NULL, so at most one line per
   * attribute can exist and the match can never be ambiguous. `normalizeLines`
   * has already dropped lines naming no attribute, and `duplicateError` has
   * already refused a set naming one twice.
   */
  const { data: existing, error: exErr } = await s
    .from("material_attribute_lines")
    .select("id, attribute_id")
    .eq("material_attribute_id", id);
  if (exErr) return fail(exErr.message);
  const stored = (existing ?? []) as { id: string; attribute_id: string | null }[];

  const byAttr = new Map<string, string>();
  for (const r of stored) if (r.attribute_id) byAttr.set(r.attribute_id, r.id);

  const claimed = new Set<string>();
  const resolved = lines.map((l) => {
    const lineId = byAttr.get(l.row.attribute_id as string) ?? null;
    const keep = lineId && !claimed.has(lineId) ? lineId : null;
    if (keep) claimed.add(keep);
    return { id: keep, line: l };
  });

  /* GONE — a line the operator removed, or one already orphaned by the old bug
     (`attribute_id` NULL, so it matches nothing and cannot be kept). Its answers
     are nulled, which is correct: the set no longer asks that question. */
  const removed = stored.map((r) => r.id).filter((rid) => !claimed.has(rid));
  if (removed.length) {
    const { error: delErr } = await s.from("material_attribute_lines").delete().in("id", removed);
    if (delErr) return fail(delErr.message);
  }

  // KEPT — updated in place, so every Material's answers stay attached.
  for (const r of resolved) {
    if (!r.id) continue;
    const { error: upErr } = await s
      .from("material_attribute_lines")
      .update(r.line.row)
      .eq("id", r.id);
    if (upErr) return fail(lineErrorMessage(upErr));
  }

  // NEW.
  const fresh = resolved.filter((r) => !r.id).map((r) => r.line);
  if (fresh.length) {
    const { data: created, error: insErr } = await s
      .from("material_attribute_lines")
      .insert(fresh.map((l) => ({ ...l.row, material_attribute_id: id })))
      .select("id, sno");
    if (insErr) return fail(lineErrorMessage(insErr));
    const idBySno = new Map((created ?? []).map((r) => [r.sno as number, r.id as string]));
    for (const r of resolved) {
      if (r.id) continue;
      r.id = idBySno.get(r.line.row.sno) ?? null;
    }
  }

  /* OPTIONS, replaced per line. Safe in the way the tables above are not:
     nothing points at `material_attribute_line_options`, so re-creating one
     orphans nothing. Cleared for EVERY line including the kept ones, or a value
     the operator deleted would outlive the save. */
  const withIds = resolved.filter((r): r is typeof r & { id: string } => !!r.id);
  if (withIds.length) {
    const { error: optDel } = await s
      .from("material_attribute_line_options")
      .delete()
      .in("material_attribute_line_id", withIds.map((r) => r.id));
    if (optDel) return fail(optDel.message);
  }
  const optionRows = withIds.flatMap((r) =>
    r.line.options.map((o) => ({ ...o, material_attribute_line_id: r.id })),
  );
  if (optionRows.length) {
    const { error: oErr } = await s
      .from("material_attribute_line_options")
      .insert(optionRows);
    if (oErr) return fail(lineErrorMessage(oErr));
  }
  rev();
  return { ok: true };
}

export async function deleteMaterialAttribute(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // A Material's use of this set is not an FK, so `deleteOrBlock`'s catalog RPC
  // cannot see it and offered the delete anyway (client 2026-08-11). This is the
  // real guard — the disabled row action on the screen is only a courtesy, and
  // `lib/data-io` reaches this action without passing the screen at all.
  //
  // It FAILS CLOSED. Every way of not getting an answer — a read error, a row
  // that cannot be seen — refuses the delete, because "I could not check" and
  // "it is not in use" must never produce the same outcome: the second one
  // deletes, and `deleteOrBlock` below cannot catch what it misses.
  const { data: row, error: rowErr } = await s
    .from("material_attributes")
    .select("id, item_class_id, category_id, lines:material_attribute_lines(id)")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) return fail("Could not check whether this Material Attribute set is in use — nothing was deleted. Please try again.");
  if (row) {
    let usedBy: string | null;
    try {
      const usage = await materialAttributeUsage(s, [row]);
      usedBy = materialsUsedByLabel(usage.get(id) ?? 0);
    } catch {
      return fail("Could not check whether this Material Attribute set is in use — nothing was deleted. Please try again.");
    }
    if (usedBy) return fail(`In use by ${usedBy} — cannot delete.`);
  }
  // A null `row` with no error is the one benign case: the set is already gone.
  // `deleteOrBlock` then deletes nothing and reports success, which is correct.
  // Lines cascade (RPC ignores cascade children); block only if referenced elsewhere.
  const res = await deleteOrBlock(s, "material_attributes", id);
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true };
}
