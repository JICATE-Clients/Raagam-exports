"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { taApprovalInput, type TaApprovalInput } from "./ta-approval-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/system");
  revalidatePath("/masters/system/ta-approvals");
}

/**
 * `short_name` is gone from the FORM but not from the row — see the header
 * note in `ta-approval-types.ts`. It has to keep looking like the existing
 * seeded values (`PPSAMPLE`, `FITSAMPLE`, …: uppercase, no separators)
 * because `lib/orders/amendments/service.ts` finds PP Sample by
 * `ILIKE 'PPSAMPLE'` — a code derived any other way (e.g. truncating to a
 * fixed length) risks a future collision or, worse, silently drifting from
 * that convention. Stripping every non-alphanumeric character from the
 * uppercased name reproduces every existing row's short_name exactly for the
 * ones that ARE a plain space-join of the name ("PP SAMPLE" → "PPSAMPLE",
 * "LAP DIP" → "LAPDIP") and is deterministic and collision-checked for the
 * rest.
 */
function deriveShortName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createTaApproval(data: TaApprovalInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = taApprovalInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "ta_approvals", p.data.name, { label: "name" });
  if (!dupName.ok) return fail(dupName.error);
  const shortName = deriveShortName(p.data.name);
  if (!shortName) return fail('"Name" must contain at least one letter or digit.');
  const { error } = await s.from("ta_approvals").insert({
    ...p.data,
    short_name: shortName,
    // Every approval is Merchandising in practice (0542); ordering is now
    // computed dynamically from T&A lead times, never edited here.
    department: "MERCHANDISING",
    sequence: 0,
    // Every seeded row requires proof (0534/0542); the "Mark Sent" gate in
    // lib/ta/approvals-worklist-actions.ts defaults a null/missing flag to
    // `true` as well, so this is the conservative default, not an arbitrary one.
    requires_proof: true,
  });
  if (error) {
    // uq_ta_approvals_short_name (0534/0542) fires when two names collapse to
    // the same code once stripped — rare, but a raw Postgres unique-violation
    // message would point at a column the operator never sees.
    if (error.code === "23505") return fail(`"${p.data.name}" is too close to an existing approval's name. Use a different name.`);
    return fail(error.message);
  }
  rev();
  return { ok: true };
}

export async function updateTaApproval(id: string, data: TaApprovalInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = taApprovalInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "ta_approvals", p.data.name, {
    label: "name",
    excludeId: id,
  });
  if (!dupName.ok) return fail(dupName.error);
  // short_name/department/sequence/requires_proof are not in `p.data` at all,
  // so this leaves them exactly as stored — renaming "PP Sample" here must
  // never touch the "PPSAMPLE" code the amendments bridge matches on, and
  // editing an approval must never silently flip its proof requirement.
  const { error } = await s.from("ta_approvals").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteTaApproval(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "ta_approvals", id);
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
