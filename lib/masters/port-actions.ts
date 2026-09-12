"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { portInput, type PortInput } from "./port-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/port");
}

export async function createPort(data: PortInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = portInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Mirrors destinations' (country_id, short_name) scoping — no DB unique
  // index backs this one yet, so this is the only guard against a duplicate.
  const dup = await checkDuplicateName(s, "ports", p.data.short_name, {
    nameColumn: "short_name",
    scope: { country_id: p.data.country_id },
    label: "short name",
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("ports").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updatePort(id: string, data: PortInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = portInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "ports", p.data.short_name, {
    nameColumn: "short_name",
    scope: { country_id: p.data.country_id },
    excludeId: id,
    label: "short name",
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("ports").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

/**
 * SOFT-DISABLES A PORT THAT IS STILL REFERENCED, since 0547 gave `ports` an
 * `inactive` column.
 *
 * It called `deleteOrBlock` before that, which is the flagless masters' path:
 * a referenced row could not be deleted and there was nothing to switch off
 * instead, so the operator was told "In use by Customers — cannot delete." and
 * had no way to retire the berth at all. With the flag it takes the same route
 * every other Associates master takes, and the caller's toast says which of the
 * two happened (`deletedToast`) rather than promising a deletion.
 */
export async function deletePort(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "ports", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
