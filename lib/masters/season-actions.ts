"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { seasonInput, type SeasonInput } from "./season-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/system");
  revalidatePath("/masters/system/season");
  // Sample Entry's Season picker reads this master.
  revalidatePath("/sales/sample-entry");
}

export async function createSeason(data: SeasonInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = seasonInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "seasons", p.data.season_name, { nameColumn: "season_name", label: "season" });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("seasons").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateSeason(id: string, data: SeasonInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = seasonInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "seasons", p.data.season_name, {
    nameColumn: "season_name",
    label: "season",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("seasons").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

/** Delete a season, or switch it off if a sample entry still names it.
 *  `inactive` is the column (0305 renamed `blocked` on `seasons`). */
export async function deleteSeason(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "seasons", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
