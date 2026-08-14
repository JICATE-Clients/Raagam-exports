"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { sizeGroupInput, type SizeGroupInput } from "./size-group-types";
import { checkDuplicateName } from "./dup-guard";
import { generateUniqueCode } from "./auto-code";

/**
 * Size Group actions — RESTORED 2026-08-10.
 *
 * This file was deleted in `129c59f` ("withdraw the 30 Materials children the
 * business does not use") and is back because the Style master now fills a
 * style's sizes from a group, which needs a way to maintain them. Say that out
 * loud rather than quietly reversing the withdrawal: it was withdrawn as unused
 * and is now used.
 *
 * NOT a straight `git restore`. The deleted version was stale in two ways and
 * both are corrected here — see `deactivateSizeGroup` and the duplicate guard.
 */

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/size-groups");
  // The Style master reads groups to fill a style's sizes.
  revalidatePath("/orders/styles");
}

/** One size row under a group. Exported so a quick-create surface can build the
 *  same shape the master screen does, rather than re-declaring it. */
export type ChildSize = { size_name: string; sort_order: number | null };

/**
 * THE NAME IS THE GUARD, NOT THE CODE.
 *
 * The deleted version checked `size_group_no` only. That is the shape AGENTS.md
 * §Duplicates calls out by name: `generateUniqueCode` SUFFIXES on collision
 * (`MENSTOP` → `MENSTOP2`), so a `unique(size_group_no)` constraint can never
 * fire and two groups called "MENS TOP S-XXL" both save. The name check belongs
 * outside the auto-code branch, always.
 */
async function guardName(
  s: Awaited<ReturnType<typeof createClient>>,
  name: string | null | undefined,
  excludeId?: string,
): Promise<Failure | null> {
  const dup = await checkDuplicateName(s, "size_groups", name, {
    nameColumn: "size_group_name",
    excludeId,
    label: "name",
  });
  return dup.ok ? null : fail(dup.error);
}

/** Blank rows dropped, order renumbered 1..n from the grid's own order. */
function normalize(children: ChildSize[]): ChildSize[] {
  return children
    .filter((c) => c.size_name.trim())
    .map((c, i) => ({ size_name: c.size_name.trim(), sort_order: i + 1 }));
}

export async function createSizeGroup(
  data: SizeGroupInput,
  children: ChildSize[],
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = sizeGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();

  const bad = await guardName(s, p.data.size_group_name);
  if (bad) return bad;

  // Codes are not asked for (client 2026-07-23) — derived from the name.
  if (!p.data.size_group_no?.trim()) {
    p.data.size_group_no = await generateUniqueCode(
      s,
      "size_groups",
      p.data.size_group_name ?? "",
      { codeColumn: "size_group_no" },
    );
  }

  const { data: row, error } = await s
    .from("size_groups")
    .insert(p.data)
    .select("id")
    .single();
  if (error || !row) return fail(error?.message ?? "Failed to create size group");

  const rows = normalize(children);
  if (rows.length > 0) {
    const { error: childErr } = await s
      .from("size_group_sizes")
      .insert(rows.map((c) => ({ size_group_id: row.id, ...c })));
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updateSizeGroup(
  id: string,
  data: SizeGroupInput,
  children: ChildSize[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = sizeGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();

  const bad = await guardName(s, p.data.size_group_name, id);
  if (bad) return bad;

  // A blank code on update KEEPS the stored one — the form does not edit codes,
  // so writing the parsed blank would erase it.
  const patch: Partial<SizeGroupInput> = { ...p.data };
  if (!p.data.size_group_no?.trim()) delete patch.size_group_no;

  const { error } = await s.from("size_groups").update(patch).eq("id", id);
  if (error) return fail(error.message);

  // Children replaced wholesale — the same shape every child grid in this app
  // uses, so a removed row really disappears rather than lingering.
  await s.from("size_group_sizes").delete().eq("size_group_id", id);
  const rows = normalize(children);
  if (rows.length > 0) {
    const { error: childErr } = await s
      .from("size_group_sizes")
      .insert(rows.map((c) => ({ size_group_id: id, ...c })));
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true };
}

export async function deactivateSizeGroup(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  /**
   * `inactive`, NOT `blocked`.
   *
   * The deleted version wrote `{ blocked: true }` — the column
   * `0305_new_tables_blocked_to_inactive.sql:12` renamed. The code was deleted
   * BEFORE that migration, so it froze with the old name and would fail at
   * runtime today. This is the reason this file was rewritten rather than
   * restored from git.
   */
  const { error } = await s.from("size_groups").update({ inactive: true }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
