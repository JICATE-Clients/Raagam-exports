"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { processInput, type ProcessInput } from "./process-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/processes");
}

/** Clear sub-categories when Has Sub Categories is off; else drop blank-name
 *  rows and renumber sno 1..n so persisted lines mirror the checkbox.
 *
 *  `short_description` is NOT here: the client removed it from both the header
 *  and this grid (2026-09-16, doc/order/fabriprocess.md §4) and 0565 dropped the
 *  columns — see `lib/masters/process-types.ts`. */
function normalizeSubCategories(
  data: ProcessInput,
): { sno: number; sub_category: string; hsn_code: string | null }[] {
  if (!data.has_sub_categories) return [];
  return data.sub_categories
    .map((c) => ({ ...c, sub_category: c.sub_category.trim() }))
    .filter((c) => c.sub_category.length > 0)
    .map((c, i) => ({
      sno: i + 1,
      sub_category: c.sub_category,
      hsn_code: c.hsn_code?.trim() || null,
    }));
}

/**
 * THE FABRIC-STAGE MAPPING, blank rows dropped (0563).
 *
 * Three things it enforces, and each is a rule the grid states on screen:
 *
 * - **A row with no stage is not a statement** and is dropped. The grid opens
 *   with one blank row by contract (AGENTS.md, "Editable sub-tables open with a
 *   row"), so the untouched seed row must never reach the table — and the test
 *   is the field the OPERATOR has to fill, never the `is_base` tick beside it,
 *   which defaults to `false` and would make its clause the constant `true`
 *   wearing the shape of evidence (the Material BOM phantom-line bug this
 *   repo's `check-blank-row-filter.mts` exists for).
 * - **One row per stage.** `unique (process_id, stage_id)` is the DB's half; the
 *   grid withholds already-taken stages from the picker (`usedIds`). This is the
 *   third half — a duplicate arriving any other way is dropped rather than
 *   failing the whole save.
 * - **A process that is not `for_fabric` has no stage route at all.** A stage is
 *   a state of CLOTH; a garment or trims process running "in the Dyed stage" is
 *   not a thing the ledger can mean. Same shape as `has_sub_categories` gating
 *   the grid above.
 */
function normalizeFabricStages(data: ProcessInput): { stage_id: string; is_base: boolean }[] {
  if (!data.for_fabric) return [];
  const seen = new Set<string>();
  const out: { stage_id: string; is_base: boolean }[] = [];
  for (const s of data.fabric_stages) {
    if (!s.stage_id || seen.has(s.stage_id)) continue;
    seen.add(s.stage_id);
    out.push({ stage_id: s.stage_id, is_base: s.is_base });
  }
  return out;
}

export async function createProcess(data: ProcessInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = processInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { sub_categories: _drop, fabric_stages: _dropStages, ...header } = p.data;
  void _drop;
  void _dropStages;
  const {
    data: { user },
  } = await s.auth.getUser();
  let createdBy: string | null = null;
  if (user) {
    const { data: profile } = await s
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    createdBy = profile?.full_name || profile?.email || null;
  }
  const dup = await checkDuplicateName(s, "processes", header.name);
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("processes")
    .insert({ ...header, created_by: createdBy })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeSubCategories(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("process_sub_categories")
      .insert(rows.map((r) => ({ ...r, process_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  const stages = normalizeFabricStages(p.data);
  if (stages.length) {
    const { error: sErr } = await s
      .from("process_fabric_stages")
      .insert(stages.map((r) => ({ ...r, process_id: created.id })));
    if (sErr) return fail(sErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateProcess(id: string, data: ProcessInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = processInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  /* BOTH CHILD GRIDS COME OFF THE HEADER, and `fabric_stages` was missed when
     0563 added it — `createProcess` above strips both, this one stripped only
     `sub_categories`, so every EDIT sent the stage rows to `processes` as if
     they were a column and PostgREST refused the save outright:
     "Could not find the 'fabric_stages' column of 'processes'" (client
     2026-09-17). A child grid's rows are written by their own insert below;
     nothing here may reach the header update. */
  const { sub_categories: _drop, fabric_stages: _dropStages, ...header } = p.data;
  void _drop;
  void _dropStages;
  const dup = await checkDuplicateName(s, "processes", header.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("processes").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the sub-category grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("process_sub_categories").delete().eq("process_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeSubCategories(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("process_sub_categories")
      .insert(rows.map((r) => ({ ...r, process_id: id })));
    if (cErr) return fail(cErr.message);
  }
  // The stage mapping, replaced wholesale for the same reason the grid above is:
  // a small, fully-loaded set the screen always holds in its entirety. Nothing
  // else in the app writes this table, so there is no row here that the editor
  // did not just send back (contrast `material_attributes`, where a wholesale
  // replace over an `ON DELETE SET NULL` FK orphaned rows).
  const { error: sDelErr } = await s.from("process_fabric_stages").delete().eq("process_id", id);
  if (sDelErr) return fail(sDelErr.message);
  const stages = normalizeFabricStages(p.data);
  if (stages.length) {
    const { error: sErr } = await s
      .from("process_fabric_stages")
      .insert(stages.map((r) => ({ ...r, process_id: id })));
    if (sErr) return fail(sErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteProcess(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "processes", id, "blocked"); // sub-cats cascade
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
