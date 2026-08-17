"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  sizeGroupInput,
  sizeChildrenInput,
  type SizeGroupInput,
} from "./size-group-types";
import { checkDuplicateName } from "./dup-guard";
import { normName } from "./name-dictionary";
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

/**
 * Blank rows dropped, order renumbered 1..n from the grid's own order, and the
 * name put through `normName` — the SAME normaliser 0425's unique index mirrors
 * in SQL, so what this returns is what the index will compare.
 */
function normalize(children: ChildSize[]): ChildSize[] {
  return children
    .filter((c) => c.size_name.trim())
    .map((c, i) => ({ size_name: normName(c.size_name), sort_order: i + 1 }));
}

/**
 * THE SAME SIZE TWICE IN ONE GROUP — refused, not silently dropped.
 *
 * `normalize()` above used to be the only thing standing between the grid and
 * Postgres, and it deduped nothing: `MENS TOP -> S, M, S` saved cleanly. The
 * screens now block it live, so this fires on form state posted from a tab that
 * was open before that guard, and on the quick-create sheet's payload.
 *
 * REFUSING is the point. De-duplicating here would be tidier code and worse
 * behaviour: the operator typed three rows, and a save that quietly stores two
 * is data loss wearing a success toast. It is also how this went unnoticed for
 * so long — the Style master's "Fill sizes" builds a name->id Map, so the repeat
 * already disappears on use, with nothing said.
 *
 * Comparison matches 0425's index: `normalize()` has already applied `normName`.
 */
function duplicateError(rows: ChildSize[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.size_name)) {
      return `The size "${r.size_name}" is listed twice — each size may appear only once in a group. Remove the duplicate and save again.`;
    }
    seen.add(r.size_name);
  }
  return null;
}

/**
 * Postgres reports a violated unique index by its name; translate 0425's two
 * rather than letting "duplicate key value violates unique constraint …" land in
 * a toast. Anything else passes through unchanged.
 *
 * These fire only on a race — two operators saving the same name at once, which
 * the guards above cannot see. That they are unreachable in normal use is not a
 * reason to skip them: an error nobody can act on is worst exactly when it is
 * rarest, because there is no habit to fall back on.
 */
function sizeErrorMessage(err: { code?: string; message: string }): string {
  if (err.code !== "23505") return err.message;
  if (err.message.includes("uq_size_group_sizes_group_name")) {
    return "The same size is listed twice — each size may appear only once in a group.";
  }
  if (err.message.includes("uq_size_groups_name")) {
    return "A size group with that name already exists. Use a different name.";
  }
  return err.message;
}

/** Blank-dropped, renumbered, normalised — then shape-checked and dup-checked.
 *  One helper so create and update cannot drift apart on any of the four. */
function prepareChildren(children: ChildSize[]): { rows: ChildSize[] } | Failure {
  const rows = normalize(children);

  const parsed = sizeChildrenInput.safeParse(rows);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid size");

  const dup = duplicateError(rows);
  if (dup) return fail(dup);

  return { rows };
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

  // CHILDREN VETTED BEFORE THE PARENT IS WRITTEN. There is no transaction across
  // these two statements, so refusing after the insert would leave a group with
  // no sizes behind — the exact "created something that appears to succeed and
  // is unusable" shape the quick-create sheet's header warns about.
  const prepared = prepareChildren(children);
  if ("ok" in prepared) return prepared;

  // Codes are not asked for (client 2026-07-23) — derived from the name.
  if (!p.data.size_group_no?.trim()) {
    p.data.size_group_no = await generateUniqueCode(
      s,
      "size_groups",
      p.data.size_group_name,
      { codeColumn: "size_group_no" },
    );
  }

  const { data: row, error } = await s
    .from("size_groups")
    .insert(p.data)
    .select("id")
    .single();
  if (error || !row) {
    return fail(error ? sizeErrorMessage(error) : "Failed to create size group");
  }

  if (prepared.rows.length > 0) {
    const { error: childErr } = await s
      .from("size_group_sizes")
      .insert(prepared.rows.map((c) => ({ size_group_id: row.id, ...c })));
    if (childErr) return fail(sizeErrorMessage(childErr));
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

  // Before the update, and before the delete below especially: the children are
  // replaced wholesale, so a refusal after that point would have already thrown
  // away the sizes the group had.
  const prepared = prepareChildren(children);
  if ("ok" in prepared) return prepared;

  // A blank code on update KEEPS the stored one — the form does not edit codes,
  // so writing the parsed blank would erase it.
  const patch: Partial<SizeGroupInput> = { ...p.data };
  if (!p.data.size_group_no?.trim()) delete patch.size_group_no;

  const { error } = await s.from("size_groups").update(patch).eq("id", id);
  if (error) return fail(sizeErrorMessage(error));

  // Children replaced wholesale — the same shape every child grid in this app
  // uses, so a removed row really disappears rather than lingering.
  await s.from("size_group_sizes").delete().eq("size_group_id", id);
  if (prepared.rows.length > 0) {
    const { error: childErr } = await s
      .from("size_group_sizes")
      .insert(prepared.rows.map((c) => ({ size_group_id: id, ...c })));
    if (childErr) return fail(sizeErrorMessage(childErr));
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
